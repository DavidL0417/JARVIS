import {
  classifyCanvasNodeKind,
  isAllowedCanvasUrl,
  isLikelyCanvasTabUrl,
  looksLikeActiveAssessment,
  normalizeUrl,
} from "./guardrails.js"
import { normalizeJarvisAppBaseUrl } from "./jarvis-app-url.js"

const STORAGE_KEYS = {
  appBaseUrl: "jarvisAppBaseUrl",
  extensionToken: "jarvisExtensionToken",
  lastCommand: "jarvisLastCommand",
}

const TAB_LOAD_TIMEOUT_MS = 25000
const POLL_ALARM = "jarvis-canvas-command-poll"
let activeCommandPromise = null

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomScanId() {
  return `canvas-command-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function storageGet(keys) {
  return chrome.storage.local.get(keys)
}

async function storageSet(values) {
  return chrome.storage.local.set(values)
}

async function storageRemove(keys) {
  return chrome.storage.local.remove(keys)
}

async function setLastCommand(command, status = command.status, message = null) {
  await storageSet({
    [STORAGE_KEYS.lastCommand]: {
      ...command,
      status,
      result: message ? { ...(command.result || {}), message } : command.result,
      updatedAt: new Date().toISOString(),
    },
  })
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

async function findCanvasTab(preferredOrigin = null, appBaseUrl = null) {
  const tabs = await chrome.tabs.query({})
  const appOrigin = appBaseUrl ? new URL(normalizeJarvisAppBaseUrl(appBaseUrl)).origin : null

  for (const tab of tabs) {
    if (!tab.id || !tab.url) continue

    try {
      const origin = new URL(tab.url).origin
      if (appOrigin && origin === appOrigin) continue
      if (preferredOrigin && origin !== preferredOrigin) continue
      if (!isLikelyCanvasTabUrl(tab.url)) continue
      if (isAllowedCanvasUrl(tab.url, origin)) return tab
    } catch {
      // Ignore non-web tabs.
    }
  }

  const activeTab = await getActiveTab()
  if (activeTab?.id && activeTab.url) {
    const origin = new URL(activeTab.url).origin
    if (appOrigin && origin === appOrigin) return null
    if (!isLikelyCanvasTabUrl(activeTab.url)) return null
    if (isAllowedCanvasUrl(activeTab.url, origin)) return activeTab
  }

  return null
}

async function waitForTabComplete(tabId) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < TAB_LOAD_TIMEOUT_MS) {
    const tab = await chrome.tabs.get(tabId)
    if (tab.status === "complete") return
    await sleep(300)
  }
}

async function injectCollector(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  })
}

async function collectPage(tabId, scanId) {
  await injectCollector(tabId)
  return chrome.tabs.sendMessage(tabId, {
    type: "JARVIS_COLLECT_CANVAS_PAGE",
    scanId,
  })
}

async function postJson(appBaseUrl, extensionToken, path, body) {
  const response = await fetch(`${normalizeJarvisAppBaseUrl(appBaseUrl)}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${extensionToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok || !payload) {
    throw new Error(payload?.details || payload?.error || `JARVIS request failed (${response.status}).`)
  }

  return payload
}

async function reportCommand(appBaseUrl, extensionToken, body) {
  return postJson(appBaseUrl, extensionToken, "/api/integrations/canvas/extension/worker/report", body)
}

function linkText(link) {
  return link.text?.trim() || new URL(link.url).pathname.split("/").filter(Boolean).at(-1)?.replace(/[-_]/g, " ") || "Canvas page"
}

function courseIdFor(url) {
  try {
    return new URL(url).pathname.match(/^\/courses\/(\d+)(\/|$)/)?.[1] || null
  } catch {
    return null
  }
}

function courseNodesFromAllCourses(snapshot) {
  const origin = new URL(snapshot.canvasOrigin).origin
  const courses = new Map()

  for (const row of snapshot.courseRows || []) {
    const normalized = normalizeUrl(row.url, snapshot.url)
    if (!normalized || !isAllowedCanvasUrl(normalized, origin)) continue
    const courseId = courseIdFor(normalized)
    if (!courseId || courses.has(courseId)) continue
    const courseUrl = `${origin}/courses/${courseId}`
    courses.set(courseId, {
      parentUrl: null,
      canvasOrigin: origin,
      url: courseUrl,
      title: row.title || `Course ${courseId}`,
      kind: "course",
      textPreview: [row.group, row.term, row.enrolledAs, row.published ? `Published: ${row.published}` : null].filter(Boolean).join(" · ") || null,
      metadata: {
        level: "course",
        courseId,
        enrollmentGroup: row.group || null,
        term: row.term || null,
        enrolledAs: row.enrolledAs || null,
        published: row.published || null,
      },
      selected: false,
    })
  }

  if (courses.size === 0) {
    for (const link of snapshot.links) {
      const normalized = normalizeUrl(link.url, snapshot.url)
      if (!normalized || !isAllowedCanvasUrl(normalized, origin)) continue
      const parsed = new URL(normalized)
      const courseId = parsed.pathname.match(/^\/courses\/(\d+)\/?$/)?.[1] || null
      if (!courseId || courses.has(courseId)) continue
      courses.set(courseId, {
        parentUrl: null,
        canvasOrigin: origin,
        url: `${origin}/courses/${courseId}`,
        title: link.text || `Course ${courseId}`,
        kind: "course",
        metadata: { level: "course", courseId, discoveredFrom: "all_courses_links" },
        selected: false,
      })
    }
  }

  return Array.from(courses.values())
}

function tabNodeUrl(normalized, parentNode, title) {
  if (normalized !== parentNode.url) return normalized
  return `${normalized}?jarvis_tab=${encodeURIComponent(title.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "home")}`
}

function actualUrlForNode(node) {
  return typeof node.metadata?.actualUrl === "string" ? node.metadata.actualUrl : node.url
}

function childNodesFromSnapshot(snapshot, parentNode) {
  const origin = new URL(snapshot.canvasOrigin).origin
  const seen = new Set()
  const children = []
  const parentLevel = parentNode.metadata?.level

  if (parentNode.kind === "course") {
    if (!snapshot.courseNavLinks?.length) {
      throw new Error("Canvas course navigation was not found. Open the course home page and try scraping tabs again.")
    }

    for (const link of snapshot.courseNavLinks) {
      const normalized = normalizeUrl(link.url, snapshot.url)
      if (!normalized || !isAllowedCanvasUrl(normalized, origin)) continue
      const title = linkText({ ...link, url: normalized }).slice(0, 240)
      const nodeUrl = tabNodeUrl(normalized, parentNode, title)
      if (seen.has(nodeUrl)) continue
      seen.add(nodeUrl)

      children.push({
        parentId: parentNode.id,
        canvasOrigin: origin,
        url: nodeUrl,
        title,
        kind: normalized === parentNode.url ? "section" : classifyCanvasNodeKind(normalized, link.text || ""),
        textPreview: null,
        metadata: {
          level: "tab",
          sourceTab: title,
          actualUrl: normalized,
          discoveredFrom: parentNode.id,
          linkText: link.text,
          selectedByParent: false,
        },
        selected: false,
      })
    }

    return children
  }

  for (const link of snapshot.pageItemLinks || snapshot.links) {
    const normalized = normalizeUrl(link.url, snapshot.url)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    if (!isAllowedCanvasUrl(normalized, origin)) continue
    if (normalized === parentNode.url) continue

    children.push({
      parentId: parentNode.id,
      canvasOrigin: origin,
      url: normalized,
      title: linkText({ ...link, url: normalized }).slice(0, 240),
      kind: classifyCanvasNodeKind(normalized, link.text || ""),
      textPreview: snapshot.visibleText?.slice(0, 900) || null,
      metadata: {
        level: parentLevel === "tab" ? "item" : "tab",
        sourceTab: parentNode.metadata?.sourceTab || parentNode.title,
        discoveredFrom: parentNode.id,
        linkText: link.text,
        selectedByParent: false,
      },
      selected: false,
    })
  }

  return children
}

async function navigateAndCollect(tab, url, scanId) {
  await chrome.tabs.update(tab.id, { url })
  await waitForTabComplete(tab.id)
  return collectPage(tab.id, scanId)
}

async function navigateNodeAndCollect(tab, node, scanId) {
  return navigateAndCollect(tab, actualUrlForNode(node), scanId)
}

async function executeDiscover(command, context) {
  const tab = await findCanvasTab(null, context.appBaseUrl)
  if (!tab?.id || !tab.url) throw new Error("Open Canvas in a browser tab before discovering courses.")
  const origin = new URL(tab.url).origin
  const scanId = randomScanId()

  await reportCommand(context.appBaseUrl, context.extensionToken, {
    commandId: command.id,
    status: "progress",
    message: "Opening Canvas All Courses.",
  })

  const snapshot = await navigateAndCollect(tab, `${origin}/courses`, scanId)
  const nodes = courseNodesFromAllCourses(snapshot)

  await reportCommand(context.appBaseUrl, context.extensionToken, {
    commandId: command.id,
    status: "succeeded",
    message: `Discovered ${nodes.length} Canvas course(s) from All Courses.`,
    nodes,
    result: { nodeCount: nodes.length, canvasOrigin: origin },
  })
}

async function executeExpandNode(command, context) {
  const parentNode = context.nodes.find((node) => node.id === command.targetNodeId)
  if (!parentNode) throw new Error("Canvas node was not included with expand command.")
  const tab = await findCanvasTab(parentNode.canvasOrigin, context.appBaseUrl)
  if (!tab?.id) throw new Error("Open the matching Canvas site before expanding this node.")
  const snapshot = await navigateNodeAndCollect(tab, parentNode, randomScanId())
  const nodes = childNodesFromSnapshot(snapshot, parentNode)
  const parentLevel = parentNode.kind === "course" ? "course" : parentNode.metadata?.level || "tab"

  await reportCommand(context.appBaseUrl, context.extensionToken, {
    commandId: command.id,
    status: "succeeded",
    message: parentLevel === "course" ? `Scraped ${nodes.length} Canvas tab(s).` : `Scraped ${nodes.length} item(s).`,
    nodes,
    result: { nodeCount: nodes.length, expandedNodeId: parentNode.id, expandedLevel: parentLevel },
  })
}

async function importPage(appBaseUrl, extensionToken, snapshot) {
  return postJson(appBaseUrl, extensionToken, "/api/integrations/canvas/extension/import-page", snapshot)
}

async function importFile(appBaseUrl, extensionToken, node) {
  const formData = new FormData()
  const metadata = {
    nodeId: node.id,
    canvasOrigin: node.canvasOrigin,
    url: node.url,
    title: node.title,
    fileName: node.title,
    mimeType: "application/octet-stream",
    sizeBytes: 0,
    metadataOnly: true,
    reason: "Canvas file discovered. Download/extraction deferred until file support is narrowed for this school.",
  }

  formData.append("metadata", JSON.stringify(metadata))
  const response = await fetch(`${normalizeJarvisAppBaseUrl(appBaseUrl)}/api/integrations/canvas/extension/import-file`, {
    method: "POST",
    headers: { Authorization: `Bearer ${extensionToken}` },
    body: formData,
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok || !payload) {
    throw new Error(payload?.details || payload?.error || `Canvas file import failed (${response.status}).`)
  }

  return payload
}

async function executeImportSelected(command, context) {
  const nodeIds = new Set(Array.isArray(command.payload?.nodeIds) ? command.payload.nodeIds : [])
  const nodes = context.nodes.filter((node) => nodeIds.has(node.id))
  const importedNodes = []
  const ledger = []

  if (nodes.length === 0) throw new Error("No selected Canvas nodes were provided for import.")

  for (const [index, node] of nodes.entries()) {
    const progress = await reportCommand(context.appBaseUrl, context.extensionToken, {
      commandId: command.id,
      status: "progress",
      message: `Importing ${index + 1}/${nodes.length}: ${node.title}`,
      result: { currentNodeId: node.id, importedCount: importedNodes.length, totalCount: nodes.length },
    })

    if (progress.cancelRequested) {
      await reportCommand(context.appBaseUrl, context.extensionToken, {
        commandId: command.id,
        status: "cancelled",
        message: "Import stopped by user.",
        importedNodes,
        result: { importedCount: importedNodes.length, totalCount: nodes.length },
      })
      await setLastCommand(command, "cancelled", "Import stopped by user.")
      return
    }

    try {
      if (node.kind === "file") {
        const result = await importFile(context.appBaseUrl, context.extensionToken, node)
        importedNodes.push({
          nodeId: node.id,
          sourceSnapshotId: result.sourceSnapshotId,
          sourceFileId: result.sourceFileId,
          importedAt: new Date().toISOString(),
        })
        ledger.push({ url: node.url, status: "imported", reason: "Canvas file metadata recorded.", candidateCount: 0 })
        continue
      }

      const tab = await findCanvasTab(node.canvasOrigin, context.appBaseUrl)
      if (!tab?.id) throw new Error("Open the matching Canvas site before importing selected nodes.")
      const snapshot = await navigateNodeAndCollect(tab, node, randomScanId())

      if (looksLikeActiveAssessment({ url: snapshot.url, title: snapshot.title, text: snapshot.visibleText })) {
        ledger.push({ url: node.url, status: "skipped", reason: "Active quiz or timed assessment surface.", candidateCount: 0 })
        continue
      }

      const result = await importPage(context.appBaseUrl, context.extensionToken, snapshot)
      importedNodes.push({
        nodeId: node.id,
        sourceSnapshotId: result.sourceSnapshotId,
        sourceFileId: null,
        importedAt: new Date().toISOString(),
      })
      ledger.push(result.ledgerItem)
    } catch (error) {
      ledger.push({
        url: node.url,
        status: "failed",
        reason: error instanceof Error ? error.message : "Unknown Canvas import failure.",
        candidateCount: 0,
      })
    }
  }

  await reportCommand(context.appBaseUrl, context.extensionToken, {
    commandId: command.id,
    status: "succeeded",
    message: `Imported ${importedNodes.length} Canvas node(s).`,
    importedNodes,
    result: { importedCount: importedNodes.length, totalCount: nodes.length, ledger },
  })
}

async function executeCommand(command, context) {
  await setLastCommand(command, "running")

  if (command.type === "discover") {
    await executeDiscover(command, context)
  } else if (command.type === "expand_node") {
    await executeExpandNode(command, context)
  } else if (command.type === "import_selected") {
    await executeImportSelected(command, context)
  }

  const state = await storageGet([STORAGE_KEYS.lastCommand])
  if (state[STORAGE_KEYS.lastCommand]?.id === command.id && state[STORAGE_KEYS.lastCommand]?.status === "running") {
    await setLastCommand(command, "succeeded")
  }
}

async function pollForCommand() {
  if (activeCommandPromise) return activeCommandPromise
  const config = await storageGet([STORAGE_KEYS.appBaseUrl, STORAGE_KEYS.extensionToken])
  const appBaseUrl = config[STORAGE_KEYS.appBaseUrl]
  const extensionToken = config[STORAGE_KEYS.extensionToken]
  if (!appBaseUrl || !extensionToken) return null

  const canvasTab = await findCanvasTab(null, appBaseUrl)
  const pollPayload = {
    extensionVersion: chrome.runtime.getManifest().version,
    canvasOrigin: canvasTab?.url ? new URL(canvasTab.url).origin : null,
    activeUrl: canvasTab?.url || null,
    activeTitle: canvasTab?.title || null,
  }
  const response = await postJson(appBaseUrl, extensionToken, "/api/integrations/canvas/extension/worker/poll", pollPayload)

  if (!response.command) {
    const state = await storageGet([STORAGE_KEYS.lastCommand])
    if (state[STORAGE_KEYS.lastCommand]?.status === "running") {
      await storageRemove(STORAGE_KEYS.lastCommand)
    }
    return null
  }

  activeCommandPromise = executeCommand(response.command, {
    appBaseUrl,
    extensionToken,
    nodes: response.nodes || [],
  })
    .catch(async (error) => {
      const message = error instanceof Error ? error.message : "Canvas command failed."
      await reportCommand(appBaseUrl, extensionToken, {
        commandId: response.command.id,
        status: "failed",
        message,
      })
      await setLastCommand(response.command, "failed", message)
    })
    .finally(() => {
      activeCommandPromise = null
    })

  return activeCommandPromise
}

async function pairExtension({ appBaseUrl, code }) {
  const normalizedAppBaseUrl = normalizeJarvisAppBaseUrl(appBaseUrl)
  const response = await fetch(`${normalizedAppBaseUrl}/api/integrations/canvas/extension/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      canvasOrigin: null,
      extensionVersion: chrome.runtime.getManifest().version,
    }),
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok || !payload?.extensionToken) {
    throw new Error(payload?.details || payload?.error || `Pairing failed (${response.status}).`)
  }

  await storageSet({
    [STORAGE_KEYS.appBaseUrl]: normalizedAppBaseUrl,
    [STORAGE_KEYS.extensionToken]: payload.extensionToken,
  })
  await pollForCommand()
  return { success: true }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 })
})

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 })
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) {
    pollForCommand().catch(() => {})
  }
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !["PAIR_EXTENSION", "GET_STATUS", "OPEN_CONTROL_PAGE", "POLL_NOW"].includes(message.type)) {
    return false
  }

  ;(async () => {
    if (message.type === "PAIR_EXTENSION") {
      return pairExtension(message)
    }

    if (message.type === "OPEN_CONTROL_PAGE") {
      const state = await storageGet([STORAGE_KEYS.appBaseUrl])
      if (state[STORAGE_KEYS.appBaseUrl]) {
        await chrome.tabs.create({ url: `${state[STORAGE_KEYS.appBaseUrl]}/dashboard/canvas-extension` })
      }
      return { success: true }
    }

    if (message.type === "POLL_NOW") {
      await pollForCommand()
      return { success: true }
    }

    const state = await storageGet([STORAGE_KEYS.appBaseUrl, STORAGE_KEYS.extensionToken, STORAGE_KEYS.lastCommand])
    return {
      success: true,
      paired: Boolean(state[STORAGE_KEYS.appBaseUrl] && state[STORAGE_KEYS.extensionToken]),
      appBaseUrl: state[STORAGE_KEYS.appBaseUrl] || null,
      lastCommand: state[STORAGE_KEYS.lastCommand] || null,
      busy: Boolean(activeCommandPromise),
    }
  })()
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({
      success: false,
      error: error instanceof Error ? error.message : "Extension action failed.",
    }))

  return true
})

chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (!message || !["GET_STATUS", "POLL_NOW"].includes(message.type)) {
    return false
  }

  ;(async () => {
    if (message.type === "POLL_NOW") {
      await pollForCommand()
      return { success: true }
    }

    const state = await storageGet([STORAGE_KEYS.appBaseUrl, STORAGE_KEYS.extensionToken, STORAGE_KEYS.lastCommand])
    return {
      success: true,
      paired: Boolean(state[STORAGE_KEYS.appBaseUrl] && state[STORAGE_KEYS.extensionToken]),
      appBaseUrl: state[STORAGE_KEYS.appBaseUrl] || null,
      lastCommand: state[STORAGE_KEYS.lastCommand] || null,
      busy: Boolean(activeCommandPromise),
    }
  })()
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({
      success: false,
      error: error instanceof Error ? error.message : "Extension action failed.",
    }))

  return true
})
