import {
  assignmentToNode,
  canvasApiFetch,
  canvasApiFetchAll,
  courseToNode,
  discussionToNode,
  fetchNodeApiContent,
  fileToNode,
  moduleItemsToNodes,
  pageToNode,
  tabToNode,
} from "./canvas-api.js"
import {
  classifyCanvasNodeKind,
  isAllowedCanvasUrl,
  isCaptureableExternalUrl,
  isLikelyCanvasTabUrl,
  looksLikeActiveAssessment,
  looksLikeGatedCapture,
  looksLikeLoginUrl,
  normalizeUrl,
  unwrapProxyUrl,
} from "./guardrails.js"
import { normalizeJarvisAppBaseUrl } from "./jarvis-app-url.js"

const STORAGE_KEYS = {
  appBaseUrl: "jarvisAppBaseUrl",
  extensionToken: "jarvisExtensionToken",
  lastCommand: "jarvisLastCommand",
  lastError: "jarvisLastError",
  pendingLogins: "jarvisPendingLogins",
}

const INTERACTIVE_LOGIN_TTL_MS = 6 * 60 * 1000

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
  const nextCommand = {
    ...command,
    status,
    result: message ? { ...(command.result || {}), message } : command.result,
    updatedAt: new Date().toISOString(),
  }

  await storageSet({
    [STORAGE_KEYS.lastCommand]: nextCommand,
    ...(status === "failed"
      ? {
          [STORAGE_KEYS.lastError]: {
            commandId: command.id,
            type: command.type,
            message: message || "Canvas command failed.",
            updatedAt: nextCommand.updatedAt,
          },
        }
      : {}),
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
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: "JARVIS_PING_CANVAS_READER" })
    if (pong?.ok) return
  } catch {
    // Content script not present yet; inject it below.
  }

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

function isCourseHomeUrl(url) {
  try {
    const parsed = new URL(url)
    return !parsed.search && Boolean(parsed.pathname.match(/^\/courses\/\d+\/?$/))
  } catch {
    return false
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

function nodeUpdateFromSnapshot(snapshot, node) {
  return {
    parentId: node.parentId || null,
    parentUrl: null,
    canvasOrigin: new URL(snapshot.canvasOrigin).origin,
    url: node.url,
    title: node.title,
    kind: node.kind,
    textPreview: snapshot.visibleText?.slice(0, 900) || node.textPreview || null,
    metadata: {
      ...(node.metadata || {}),
      actualUrl: actualUrlForNode(node),
      pageKindHint: snapshot.pageKindHint || null,
      pagePreview: snapshot.pagePreview || null,
      previewCapturedAt: snapshot.capturedAt,
    },
    selected: node.selected,
    expanded: true,
  }
}

function capturedNodeFromSnapshot(snapshot, parentNode, requestedUrl) {
  const parentLevel = parentNode ? parentNode.metadata?.level : null
  const normalized = normalizeUrl(snapshot.url || requestedUrl, requestedUrl)
  const title = snapshot.title || snapshot.courseHint || linkText({ url: requestedUrl, text: null })

  return {
    parentId: parentNode?.id || null,
    parentUrl: null,
    canvasOrigin: new URL(snapshot.canvasOrigin).origin,
    url: normalized || requestedUrl,
    title: title.slice(0, 240),
    kind: classifyCanvasNodeKind(normalized || requestedUrl, title),
    textPreview: snapshot.visibleText?.slice(0, 900) || null,
    metadata: {
      level: parentLevel === "course" ? "tab" : "item",
      sourceTab: parentNode?.metadata?.sourceTab || parentNode?.title || null,
      discoveredFrom: parentNode?.id || null,
      actualUrl: normalized || requestedUrl,
      capturedFromPreview: true,
      pageKindHint: snapshot.pageKindHint || null,
      pagePreview: snapshot.pagePreview || null,
      previewCapturedAt: snapshot.capturedAt,
      selectedByParent: false,
    },
    selected: false,
    expanded: true,
  }
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
    if (normalized === parentNode.url || normalized === actualUrlForNode(parentNode)) continue
    if (isCourseHomeUrl(normalized)) continue

    children.push({
      parentId: parentNode.id,
      canvasOrigin: origin,
      url: normalized,
      title: linkText({ ...link, url: normalized }).slice(0, 240),
      kind: classifyCanvasNodeKind(normalized, link.text || ""),
      textPreview: null,
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

async function discoverViaDom(command, context, tab, origin) {
  const snapshot = await navigateAndCollect(tab, `${origin}/courses`, randomScanId())
  const nodes = courseNodesFromAllCourses(snapshot)

  await reportCommand(context.appBaseUrl, context.extensionToken, {
    commandId: command.id,
    status: "succeeded",
    level: "success",
    phase: "discover_complete",
    message: `Discovered ${nodes.length} Canvas course(s) from All Courses.`,
    nodes,
    result: { nodeCount: nodes.length, canvasOrigin: origin, via: "dom" },
  })
}

async function executeDiscover(command, context) {
  const tab = await findCanvasTab(null, context.appBaseUrl)
  if (!tab?.id || !tab.url) throw new Error("Open Canvas in a browser tab before discovering courses.")
  const origin = new URL(tab.url).origin

  await reportCommand(context.appBaseUrl, context.extensionToken, {
    commandId: command.id,
    status: "progress",
    phase: "open_courses",
    message: "Loading Canvas courses from the Canvas API.",
  })

  try {
    const courses = await canvasApiFetchAll(origin, "/api/v1/courses", {
      "include[]": ["term"],
      "state[]": ["available", "completed"],
    })
    const nodes = []
    const seen = new Set()

    for (const course of courses) {
      if (!course?.id || course.access_restricted_by_date) continue
      const node = courseToNode(course, origin)
      if (seen.has(node.url)) continue
      seen.add(node.url)
      nodes.push(node)
    }

    if (nodes.length === 0) throw new Error("Canvas API returned no accessible courses.")

    await reportCommand(context.appBaseUrl, context.extensionToken, {
      commandId: command.id,
      status: "succeeded",
      level: "success",
      phase: "discover_complete",
      message: `Discovered ${nodes.length} Canvas course(s) via the Canvas API.`,
      nodes,
      result: { nodeCount: nodes.length, canvasOrigin: origin, via: "api" },
    })
  } catch (error) {
    await reportCommand(context.appBaseUrl, context.extensionToken, {
      commandId: command.id,
      status: "progress",
      level: "warning",
      phase: "api_fallback",
      message: `Canvas API course discovery unavailable (${error instanceof Error ? error.message : "unknown error"}); falling back to page scraping.`,
    })
    await discoverViaDom(command, context, tab, origin)
  }
}

function markNodeExpanded(node) {
  return {
    parentId: node.parentId || null,
    canvasOrigin: node.canvasOrigin,
    url: node.url,
    title: node.title,
    kind: node.kind,
    textPreview: node.textPreview || null,
    metadata: { ...(node.metadata || {}) },
    selected: node.selected,
    expanded: true,
  }
}

async function expandCourseViaApi(parentNode, origin) {
  const courseId = parentNode.metadata?.courseId || courseIdFor(parentNode.url)
  if (!courseId) throw new Error("Missing Canvas course id for tab expansion.")
  const tabs = await canvasApiFetchAll(origin, `/api/v1/courses/${courseId}/tabs`)
  const nodes = []
  const seen = new Set()

  for (const tab of tabs) {
    if (tab?.hidden === true) continue
    const node = tabToNode(tab, parentNode, origin)
    if (seen.has(node.url)) continue
    seen.add(node.url)
    nodes.push(node)
  }

  return nodes
}

async function expandTabViaApi(parentNode, origin) {
  // Home/Syllabus tabs are single-page content: import them directly, no children.
  if (parentNode.metadata?.apiSource) return []
  if (parentNode.metadata?.external) return []

  const courseId = parentNode.metadata?.courseId || courseIdFor(actualUrlForNode(parentNode))
  if (!courseId) return null

  switch (parentNode.metadata?.tabId) {
    case "assignments": {
      const items = await canvasApiFetchAll(origin, `/api/v1/courses/${courseId}/assignments`)
      return items.filter((item) => item?.id).map((item) => assignmentToNode(item, parentNode, origin))
    }
    case "pages": {
      const items = await canvasApiFetchAll(origin, `/api/v1/courses/${courseId}/pages`)
      return items.filter((item) => item?.url).map((item) => pageToNode(item, parentNode, origin))
    }
    case "modules": {
      const modules = await canvasApiFetchAll(origin, `/api/v1/courses/${courseId}/modules`, { "include[]": ["items"] })
      return moduleItemsToNodes(modules, parentNode, origin)
    }
    case "announcements": {
      const items = await canvasApiFetchAll(origin, "/api/v1/announcements", { "context_codes[]": [`course_${courseId}`] })
      return items.filter((item) => item?.id).map((item) => discussionToNode(item, parentNode, origin, { announcement: true }))
    }
    case "discussions": {
      const items = await canvasApiFetchAll(origin, `/api/v1/courses/${courseId}/discussion_topics`)
      return items.filter((item) => item?.id).map((item) => discussionToNode(item, parentNode, origin))
    }
    case "files": {
      const items = await canvasApiFetchAll(origin, `/api/v1/courses/${courseId}/files`)
      return items.filter((item) => item?.id).map((item) => fileToNode(item, parentNode, origin))
    }
    default:
      return null
  }
}

async function expandViaDom(command, context, parentNode) {
  const tab = await findCanvasTab(parentNode.canvasOrigin, context.appBaseUrl)
  if (!tab?.id) throw new Error("Open the matching Canvas site before expanding this node.")
  const snapshot = await navigateNodeAndCollect(tab, parentNode, randomScanId())
  const nodes = childNodesFromSnapshot(snapshot, parentNode)

  await reportCommand(context.appBaseUrl, context.extensionToken, {
    commandId: command.id,
    status: "succeeded",
    level: "success",
    phase: parentNode.kind === "course" ? "tabs_complete" : "items_complete",
    nodeId: parentNode.id,
    message: parentNode.kind === "course" ? `Scraped ${nodes.length} Canvas tab(s).` : `Scraped ${nodes.length} item(s).`,
    nodes: [nodeUpdateFromSnapshot(snapshot, parentNode), ...nodes],
    result: { nodeCount: nodes.length, expandedNodeId: parentNode.id, via: "dom" },
  })
}

async function executeExpandNode(command, context) {
  const parentNode = context.nodes.find((node) => node.id === command.targetNodeId)
  if (!parentNode) throw new Error("Canvas node was not included with expand command.")
  const origin = parentNode.canvasOrigin

  await reportCommand(context.appBaseUrl, context.extensionToken, {
    commandId: command.id,
    status: "progress",
    phase: parentNode.kind === "course" ? "open_course" : "open_tab",
    nodeId: parentNode.id,
    message: parentNode.kind === "course" ? `Loading tabs for ${parentNode.title}` : `Loading items from ${parentNode.title}`,
    details: { url: actualUrlForNode(parentNode) },
  })

  let nodes = null

  try {
    nodes = parentNode.kind === "course"
      ? await expandCourseViaApi(parentNode, origin)
      : await expandTabViaApi(parentNode, origin)
  } catch (error) {
    await reportCommand(context.appBaseUrl, context.extensionToken, {
      commandId: command.id,
      status: "progress",
      level: "warning",
      phase: "api_fallback",
      nodeId: parentNode.id,
      message: `Canvas API expand unavailable (${error instanceof Error ? error.message : "unknown error"}); falling back to page scraping.`,
    })
  }

  if (nodes === null) {
    await expandViaDom(command, context, parentNode)
    return
  }

  await reportCommand(context.appBaseUrl, context.extensionToken, {
    commandId: command.id,
    status: "succeeded",
    level: "success",
    phase: parentNode.kind === "course" ? "tabs_complete" : "items_complete",
    nodeId: parentNode.id,
    message: parentNode.kind === "course" ? `Loaded ${nodes.length} Canvas tab(s).` : `Loaded ${nodes.length} item(s).`,
    nodes: [markNodeExpanded(parentNode), ...nodes],
    result: { nodeCount: nodes.length, expandedNodeId: parentNode.id, via: "api" },
  })
}

function parseCanvasFileId(url) {
  try {
    return new URL(url).pathname.match(/\/files\/(\d+)(\/|$)/)?.[1] || null
  } catch {
    return null
  }
}

async function captureFileViaApi(command, context, parentNode, origin, fileId) {
  const courseId = parentNode.metadata?.courseId || courseIdFor(parentNode.url)
  if (!courseId) throw new Error("Missing Canvas course id for file capture.")

  let file
  try {
    file = await canvasApiFetch(origin, `/api/v1/files/${fileId}`)
  } catch {
    throw new Error("Canvas Reader could not load this file from the Canvas API.")
  }

  const mimeType = (file["content-type"] || file.content_type || "").toLowerCase()
  const fileName = file.filename || file.display_name || `file-${fileId}`
  const nodeUrl = `${origin}/courses/${courseId}/files/${fileId}`
  const size = file.size ?? 0
  const storable = size > 0 && size <= MAX_VIEW_FILE_BYTES && isStorableViewType(mimeType, fileName)

  await reportCommand(context.appBaseUrl, context.extensionToken, {
    commandId: command.id,
    status: "progress",
    phase: "capture_file",
    nodeId: parentNode.id,
    message: `Loading file: ${file.display_name || fileName}…`,
    details: { url: nodeUrl },
  })

  const form = new FormData()
  form.append("metadata", JSON.stringify({
    scanId: randomScanId(),
    canvasOrigin: origin,
    courseUrl: parentNode.url,
    courseId: String(courseId),
    courseTitle: parentNode.title,
    url: nodeUrl,
    title: file.display_name || fileName,
    fileName,
    mimeType: mimeType || "application/octet-stream",
    sizeBytes: size,
    fileId,
  }))

  // Download bytes only for storable/viewable types; media and oversized files become a
  // note node with a Canvas link (no download). Text extraction is deferred to import.
  if (storable && file.url) {
    try {
      const response = await fetch(file.url, { credentials: "include" })
      if (response.ok) {
        const blob = await response.blob()
        if (blob.size <= MAX_VIEW_FILE_BYTES) form.append("file", blob, fileName)
      }
    } catch {
      // Fall through to a note-only node.
    }
  }

  const result = await postForm(context.appBaseUrl, context.extensionToken, "/api/integrations/canvas/extension/import-file-content", form)

  await reportCommand(context.appBaseUrl, context.extensionToken, {
    commandId: command.id,
    status: "succeeded",
    level: "success",
    phase: "file_captured",
    nodeId: parentNode.id,
    message: result?.stored
      ? `Loaded file: ${file.display_name || fileName}.`
      : `Linked file: ${file.display_name || fileName} (opens in Canvas).`,
    result: { capturedUrl: nodeUrl, parentNodeId: parentNode.id, stored: Boolean(result?.stored) },
  })
}

function classifyCanvasContentUrl(url) {
  let path
  try {
    path = new URL(url).pathname
  } catch {
    return null
  }

  let match
  if (/\/courses\/\d+\/assignments\/syllabus(\/|$)/.test(path)) return { apiSource: "syllabus", kind: "page" }
  if ((match = path.match(/\/courses\/\d+\/pages\/([^/]+)/))) return { apiSource: "page", kind: "page", pageUrl: decodeURIComponent(match[1]) }
  if ((match = path.match(/\/courses\/\d+\/assignments\/(\d+)/))) return { apiSource: "assignment", kind: "assignment", assignmentId: match[1] }
  if ((match = path.match(/\/courses\/\d+\/discussion_topics\/(\d+)/))) return { apiSource: "discussion", kind: "discussion", topicId: match[1] }
  if ((match = path.match(/\/courses\/\d+\/announcements\/(\d+)/))) return { apiSource: "announcement", kind: "discussion", topicId: match[1] }
  return null
}

async function fetchCanvasContentForUrl(origin, courseId, classified) {
  if (classified.apiSource === "syllabus") {
    const data = await canvasApiFetch(origin, `/api/v1/courses/${courseId}`, { "include[]": ["syllabus_body"] })
    return { title: "Syllabus", contentHtml: data?.syllabus_body ?? null, url: `${origin}/courses/${courseId}/assignments/syllabus` }
  }
  if (classified.apiSource === "page") {
    const data = await canvasApiFetch(origin, `/api/v1/courses/${courseId}/pages/${encodeURIComponent(classified.pageUrl)}`)
    return { title: data?.title || classified.pageUrl, contentHtml: data?.body ?? null, url: data?.html_url || `${origin}/courses/${courseId}/pages/${classified.pageUrl}` }
  }
  if (classified.apiSource === "assignment") {
    const data = await canvasApiFetch(origin, `/api/v1/courses/${courseId}/assignments/${classified.assignmentId}`)
    return {
      title: data?.name || `Assignment ${classified.assignmentId}`,
      contentHtml: data?.description ?? null,
      url: data?.html_url || `${origin}/courses/${courseId}/assignments/${classified.assignmentId}`,
      dueAt: data?.due_at ?? null,
    }
  }
  const data = await canvasApiFetch(origin, `/api/v1/courses/${courseId}/discussion_topics/${classified.topicId}`)
  return { title: data?.title || `Topic ${classified.topicId}`, contentHtml: data?.message ?? null, url: data?.html_url || `${origin}/courses/${courseId}/discussion_topics/${classified.topicId}` }
}

async function captureContentViaApi(command, context, parentNode, origin, normalizedUrl) {
  const courseId = parentNode.metadata?.courseId || courseIdFor(parentNode.url)
  const classified = classifyCanvasContentUrl(normalizedUrl)
  if (!courseId || !classified) return false

  let content
  try {
    content = await fetchCanvasContentForUrl(origin, courseId, classified)
  } catch {
    return false
  }
  if (!content?.contentHtml || !content.contentHtml.trim()) return false

  await reportCommand(context.appBaseUrl, context.extensionToken, {
    commandId: command.id,
    status: "progress",
    phase: "capture_content",
    nodeId: parentNode.id,
    message: `Reading ${content.title}…`,
    details: { url: content.url },
  })

  await syncContent(context.appBaseUrl, context.extensionToken, {
    scanId: randomScanId(),
    canvasOrigin: origin,
    courseUrl: parentNode.url,
    courseId: String(courseId),
    courseTitle: parentNode.title,
    replace: false,
    items: [
      {
        url: content.url,
        title: content.title,
        kind: classified.kind,
        apiSource: classified.apiSource,
        contentHtml: content.contentHtml,
        dueAt: content.dueAt ?? null,
      },
    ],
  })

  await reportCommand(context.appBaseUrl, context.extensionToken, {
    commandId: command.id,
    status: "succeeded",
    level: "success",
    phase: "content_captured",
    nodeId: parentNode.id,
    message: `Captured ${content.title}.`,
    result: { capturedUrl: content.url, parentNodeId: parentNode.id },
  })
  return true
}

async function executeCaptureUrl(command, context) {
  const parentNode = context.nodes.find((node) => node.id === command.targetNodeId)
  if (!parentNode) throw new Error("Canvas node was not included with capture command.")

  const requestedUrl = typeof command.payload?.url === "string" ? command.payload.url : null
  if (!requestedUrl) throw new Error("Canvas capture command did not include a URL.")

  const origin = parentNode.canvasOrigin
  const normalized = normalizeUrl(requestedUrl, actualUrlForNode(parentNode))
  if (!normalized) {
    throw new Error("Canvas Reader could not resolve this link.")
  }

  // Off-Canvas readings (publisher pages, JSTOR, dictionaries) are pulled in as read-only
  // webpages using the user's own session, rather than opened in a throwaway tab.
  if (isCaptureableExternalUrl(normalized, origin)) {
    await captureExternalWebpage(command, context, parentNode, normalized)
    return
  }

  if (!isAllowedCanvasUrl(normalized, origin)) {
    throw new Error("Canvas Reader blocked this link because it is outside the safe read-only Canvas surface.")
  }

  const fileId = parseCanvasFileId(normalized)
  if (fileId) {
    await captureFileViaApi(command, context, parentNode, origin, fileId)
    return
  }

  if (await captureContentViaApi(command, context, parentNode, origin, normalized)) {
    return
  }

  const tab = await findCanvasTab(origin, context.appBaseUrl)
  if (!tab?.id) throw new Error("Open the matching Canvas site before capturing this link.")

  await reportCommand(context.appBaseUrl, context.extensionToken, {
    commandId: command.id,
    status: "progress",
    phase: "open_preview_link",
    nodeId: parentNode.id,
    message: `Opening Canvas link from ${parentNode.title}.`,
    details: { url: normalized },
  })

  const snapshot = await navigateAndCollect(tab, normalized, randomScanId())

  // A module-item link redirects to its underlying content; capture that properly (e.g. a
  // file becomes a stored, viewable PDF) instead of scraping the module-item chrome.
  const resolvedFileId = parseCanvasFileId(snapshot.url || normalized)
  if (resolvedFileId) {
    await captureFileViaApi(command, context, parentNode, origin, resolvedFileId)
    return
  }

  if (await captureContentViaApi(command, context, parentNode, origin, snapshot.url || normalized)) {
    return
  }

  if (looksLikeActiveAssessment({ url: snapshot.url, title: snapshot.title, text: snapshot.visibleText })) {
    throw new Error("Canvas Reader blocked this link because it looks like an active quiz or timed assessment surface.")
  }

  const capturedNode = capturedNodeFromSnapshot(snapshot, parentNode, normalized)

  await reportCommand(context.appBaseUrl, context.extensionToken, {
    commandId: command.id,
    status: "succeeded",
    level: "success",
    phase: "preview_link_captured",
    nodeId: parentNode.id,
    message: `Captured Canvas page: ${capturedNode.title}.`,
    nodes: [capturedNode],
    result: {
      nodeCount: 1,
      capturedUrl: capturedNode.url,
      parentNodeId: parentNode.id,
      previewLinkCount: snapshot.pagePreview?.links?.length || 0,
    },
  })
}

function escapeForNote(value) {
  return String(value || "").replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"))
}

const MAX_WEBPAGE_HTML_BYTES = 480_000

async function blobLooksLikePdf(blob) {
  try {
    const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer())
    return String.fromCharCode(...head).startsWith("%PDF")
  } catch {
    return false
  }
}

// Where the actual reading PDF tends to live for a given landing page. Order matters: the
// scholarly `citation_pdf_url` meta tag (SpringerLink and most publishers) first, then the
// JSTOR-specific terms-accepted endpoint.
function pdfCandidatesFor(target, html) {
  const candidates = []
  if (html) {
    const meta =
      html.match(/<meta[^>]+name=["']citation_pdf_url["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']citation_pdf_url["']/i)
    if (meta?.[1]) candidates.push(meta[1])
  }
  try {
    const url = new URL(target)
    if (/(^|\.)jstor\.org$/i.test(url.hostname)) {
      const match = url.pathname.match(/\/stable\/(?:pdf\/)?(\d+)/)
      if (match) candidates.push(`${url.origin}/stable/pdf/${match[1]}.pdf?acceptTC=true`)
    }
  } catch {
    // target was not a URL; no host-specific candidate.
  }
  return candidates
}

async function fetchPdfBlob(url) {
  try {
    const response = await fetch(url, { credentials: "include", redirect: "follow" })
    if (!response.ok) return null
    const blob = await response.blob()
    if (blob.size === 0 || blob.size > MAX_VIEW_FILE_BYTES) return null
    if (!(await blobLooksLikePdf(blob))) return null
    return blob
  } catch {
    return null
  }
}

// Store an off-Canvas reading PDF as a viewable file node, exactly like a Canvas file. The
// node url is the canonical (unwrapped) reading so it matches the link the user clicked.
async function storeExternalReadingPdf(command, context, parentNode, destination, title, blob) {
  const courseId = parentNode.metadata?.courseId || courseIdFor(parentNode.url) || "external"
  let host = destination
  try {
    host = new URL(destination).host
  } catch {
    // keep destination as the host label
  }
  const baseName = (title || host).replace(/[^\w.\- ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "reading"
  const fileName = baseName.toLowerCase().endsWith(".pdf") ? baseName : `${baseName}.pdf`

  const form = new FormData()
  form.append("metadata", JSON.stringify({
    scanId: randomScanId(),
    canvasOrigin: parentNode.canvasOrigin,
    courseUrl: parentNode.url,
    courseId: String(courseId),
    courseTitle: parentNode.title,
    url: destination,
    title: (title || host).slice(0, 240),
    fileName,
    mimeType: "application/pdf",
    sizeBytes: blob.size,
    fileId: null,
  }))
  form.append("file", blob, fileName)

  const result = await postForm(context.appBaseUrl, context.extensionToken, "/api/integrations/canvas/extension/import-file-content", form)

  await reportCommand(context.appBaseUrl, context.extensionToken, {
    commandId: command.id,
    status: "succeeded",
    level: "success",
    phase: "webpage_pdf_captured",
    nodeId: parentNode.id,
    message: `Loaded reading PDF: ${title || host}.`,
    result: { capturedUrl: destination, parentNodeId: parentNode.id, stored: Boolean(result?.stored) },
  })
}

// Pull an off-Canvas reading in with the user's own session. Prefers the actual reading PDF
// (so JSTOR / publisher articles read inline like a Canvas file); falls back to readable page
// markdown, and only asks the user to sign in when the source is genuinely gated.
async function captureExternalWebpage(command, context, parentNode, requested) {
  // Canvas often stores legacy http external_urls; fetch and store over https.
  const target = (requested || "").replace(/^http:\/\//i, "https://")
  let host = target
  try {
    host = new URL(target).host
  } catch {
    // keep target as the host label
  }

  await reportCommand(context.appBaseUrl, context.extensionToken, {
    commandId: command.id,
    status: "progress",
    phase: "capture_webpage",
    nodeId: parentNode.id,
    message: `Reading ${host}…`,
    details: { url: target },
  })

  // EZproxy/library links wrap the real reading; store it under the unwrapped destination so
  // different proxied readings don't collide on the shared `/login` path.
  const destination = unwrapProxyUrl(target)

  let html = ""
  let finalUrl = target
  let httpStatus = 0
  let contentType = ""
  let fetchFailed = false
  let directPdf = null

  try {
    const response = await fetch(target, { credentials: "include", redirect: "follow" })
    httpStatus = response.status
    finalUrl = response.url || target
    contentType = (response.headers.get("content-type") || "").toLowerCase()
    if (contentType.includes("application/pdf")) {
      const blob = await response.blob()
      if (blob.size > 0 && blob.size <= MAX_VIEW_FILE_BYTES && (await blobLooksLikePdf(blob))) directPdf = blob
    } else if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
      html = (await response.text()).slice(0, MAX_WEBPAGE_HTML_BYTES)
    }
    if (!response.ok) fetchFailed = true
  } catch {
    // Network error, CORS rejection, or a blocked request — let the user open it interactively.
    fetchFailed = true
  }

  const titleFromHtml = html
    ? (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim().slice(0, 240)
    : ""
  const title = titleFromHtml || host

  // PDF-first: serve the actual reading whenever the user's session can reach it. We try the
  // PDF endpoints even when the landing page looked gated — fetchPdfBlob verifies the %PDF
  // magic bytes, so a terms/login response just falls through.
  let pdfBlob = directPdf
  if (!pdfBlob) {
    for (const candidate of pdfCandidatesFor(target, html)) {
      pdfBlob = await fetchPdfBlob(candidate)
      if (pdfBlob) break
    }
  }
  if (pdfBlob) {
    await storeExternalReadingPdf(command, context, parentNode, destination, title, pdfBlob)
    return
  }

  // Sign-in / paywall gate: open the reading in a tab so the user can authenticate, then
  // capture the real article once it loads (handled by the tab-navigation listener).
  const readableTextLength = html ? html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length : 0
  const gated = fetchFailed || looksLikeGatedCapture({ target, destination, finalUrl, html, readableTextLength })
  if (gated) {
    await startInteractiveLogin(command, context, parentNode, target, destination, title)
    return
  }

  await storeExternalReadingHtml({
    command,
    context,
    parentNode,
    destination,
    target,
    finalUrl,
    title,
    contentHtml: html || `<p>This link points to a file or non-readable resource on <strong>${escapeForNote(host)}</strong>. Open the original to view it.</p>`,
    httpStatus,
    contentType,
  })
}

// Store a captured external reading as a readable webpage node. url = the unwrapped reading
// (canonical, matchable); actualUrl = the link the user clicked (re-opens through the proxy).
async function storeExternalReadingHtml({ command, context, parentNode, destination, target, finalUrl, title, contentHtml, httpStatus, contentType, loginRequired = false }) {
  const courseId = parentNode.metadata?.courseId || courseIdFor(parentNode.url) || "external"
  let host = destination
  try {
    host = new URL(destination).host
  } catch {
    // keep label
  }

  await syncContent(context.appBaseUrl, context.extensionToken, {
    scanId: randomScanId(),
    canvasOrigin: parentNode.canvasOrigin,
    courseUrl: parentNode.url,
    courseId: String(courseId),
    courseTitle: parentNode.title,
    replace: false,
    items: [
      {
        url: destination,
        title,
        kind: "external_link",
        apiSource: "external_link",
        contentHtml,
        metadata: {
          externalLink: true,
          host,
          actualUrl: target,
          finalUrl: finalUrl ?? null,
          loginRequired,
          httpStatus: httpStatus ?? null,
          contentType: contentType || null,
          capturedAt: new Date().toISOString(),
        },
      },
    ],
  })

  await reportCommand(context.appBaseUrl, context.extensionToken, {
    commandId: command.id,
    status: "succeeded",
    level: loginRequired ? "warning" : "success",
    phase: "webpage_captured",
    nodeId: parentNode.id,
    message: loginRequired ? `Opened ${host} — sign in to load this reading.` : `Captured webpage: ${title}.`,
    result: { capturedUrl: destination, parentNodeId: parentNode.id, loginRequired },
  })
}

function destinationSignature(destUrl) {
  // A distinctive token so we know the opened tab has reached the reading, even after the
  // proxy rewrites the host (e.g. www-proquest-com.turing.library.northwestern.edu).
  try {
    const url = new URL(destUrl)
    const hostLabel = url.hostname.replace(/^www\d*\./, "").split(".")[0].toLowerCase()
    let token = ""
    for (const seg of url.pathname.split("/").filter(Boolean)) {
      if (seg.length >= 6 && seg.length > token.length && /[a-z0-9]/i.test(seg)) token = seg
    }
    return { hostLabel, token: token.toLowerCase() }
  } catch {
    return { hostLabel: "", token: "" }
  }
}

function tabUrlMatchesDestination(tabUrl, signature) {
  if (!tabUrl || !signature) return false
  const lower = tabUrl.toLowerCase()
  if (signature.token && lower.includes(signature.token)) return true
  if (signature.hostLabel && signature.hostLabel.length >= 4 && lower.includes(signature.hostLabel)) return true
  return false
}

// Runs in the target tab (isolated world). Uses the vendored Mozilla Readability (injected as
// a separate file) to pull clean article text from arbitrary, JS-rendered, oddly-formatted
// pages (NYT/WSJ/publishers); falls back to the main/article element.
function extractWithReadability() {
  const textLen = (value) => (value || "").replace(/\s+/g, " ").trim().length
  const ReadabilityCtor = globalThis.Readability
  try {
    if (typeof ReadabilityCtor === "function") {
      const article = new ReadabilityCtor(document.cloneNode(true)).parse()
      if (article && article.content && textLen(article.textContent) > 200) {
        return { title: article.title || document.title || "", html: article.content, textLength: textLen(article.textContent) }
      }
    }
  } catch {
    // fall through to a plain DOM grab
  }
  const main = document.querySelector("article, main, [role='main']") || document.body
  return { title: document.title || "", html: main ? main.innerHTML : "", textLength: textLen(main ? main.innerText : "") }
}

async function extractReadableFromTab(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["readability.js"] })
  } catch {
    // Readability injection failed (restricted page); fall back to plain extraction.
  }
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: extractWithReadability })
    return results?.[0]?.result || null
  } catch {
    return null
  }
}

// A reading is behind a sign-in/paywall: open it in a tab so the user can authenticate; the
// tab-navigation listener captures the real article once it loads, then closes the tab.
async function startInteractiveLogin(command, context, parentNode, target, destination, title) {
  let host = target
  try {
    host = new URL(target).host
  } catch {
    // keep label
  }

  let tabId = null
  try {
    const tab = await chrome.tabs.create({ url: target, active: true })
    tabId = tab?.id ?? null
  } catch {
    // tab creation failed; fall back to the manual sign-in note below
  }

  if (tabId != null) {
    const store = await storageGet([STORAGE_KEYS.pendingLogins])
    const pending = store[STORAGE_KEYS.pendingLogins] || {}
    pending[String(tabId)] = {
      commandId: command.id,
      parentNodeId: parentNode.id,
      parentUrl: parentNode.url,
      canvasOrigin: parentNode.canvasOrigin,
      courseId: String(parentNode.metadata?.courseId || courseIdFor(parentNode.url) || "external"),
      courseTitle: parentNode.title,
      target,
      destination,
      title: title || host,
      signature: destinationSignature(destination),
      startedAt: Date.now(),
    }
    await storageSet({ [STORAGE_KEYS.pendingLogins]: pending })
  }

  await storeExternalReadingHtml({
    command,
    context,
    parentNode,
    destination,
    target,
    finalUrl: target,
    title: title || host,
    contentHtml: tabId != null
      ? `<p><strong>Signing in to ${escapeForNote(host)}…</strong></p><p>A tab just opened — sign in there (Northwestern SSO / Duo if asked). The moment the reading loads, JARVIS captures it here and closes the tab.</p>`
      : `<p>This reading on <strong>${escapeForNote(host)}</strong> needs you to sign in. Open the original (top-right), sign in, then use Try again.</p>`,
    httpStatus: 0,
    contentType: null,
    loginRequired: true,
  })
}

// Fired on tab navigation. When a pending interactive-login tab reaches the reading (and is no
// longer on a login page), capture the article via Readability, store it, and close the tab.
async function maybeCompleteInteractiveLogin(tabId, tab) {
  const store = await storageGet([STORAGE_KEYS.pendingLogins, STORAGE_KEYS.appBaseUrl, STORAGE_KEYS.extensionToken])
  const pending = store[STORAGE_KEYS.pendingLogins] || {}
  const entry = pending[String(tabId)]
  if (!entry) return

  if (Date.now() - (entry.startedAt || 0) > INTERACTIVE_LOGIN_TTL_MS) {
    delete pending[String(tabId)]
    await storageSet({ [STORAGE_KEYS.pendingLogins]: pending })
    return
  }

  const url = tab?.url || ""
  if (!url || looksLikeLoginUrl(url)) return
  if (!tabUrlMatchesDestination(url, entry.signature)) return

  // Give a JS-rendered article a beat to populate before extracting.
  await sleep(1500)
  const extracted = await extractReadableFromTab(tabId)
  if (!extracted || !extracted.html || (extracted.textLength ?? 0) < 200) return

  const appBaseUrl = store[STORAGE_KEYS.appBaseUrl]
  const extensionToken = store[STORAGE_KEYS.extensionToken]
  if (!appBaseUrl || !extensionToken) return

  let host = entry.destination
  try {
    host = new URL(entry.destination).host
  } catch {
    // keep label
  }

  try {
    await syncContent(appBaseUrl, extensionToken, {
      scanId: randomScanId(),
      canvasOrigin: entry.canvasOrigin,
      courseUrl: entry.parentUrl,
      courseId: entry.courseId,
      courseTitle: entry.courseTitle,
      replace: false,
      items: [
        {
          url: entry.destination,
          title: (extracted.title || entry.title || "Reading").slice(0, 240),
          kind: "external_link",
          apiSource: "external_link",
          contentHtml: extracted.html,
          metadata: {
            externalLink: true,
            host,
            actualUrl: entry.target,
            finalUrl: url,
            loginRequired: false,
            capturedAt: new Date().toISOString(),
            viaInteractiveLogin: true,
          },
        },
      ],
    })
    delete pending[String(tabId)]
    await storageSet({ [STORAGE_KEYS.pendingLogins]: pending })
    await chrome.tabs.remove(tabId).catch(() => {})
  } catch {
    // Leave the pending entry; a later navigation/render can retry.
  }
}

async function importPage(appBaseUrl, extensionToken, snapshot) {
  return postJson(appBaseUrl, extensionToken, "/api/integrations/canvas/extension/import-page", snapshot)
}

function apiContentPayload(node, origin, apiContent) {
  return {
    scanId: randomScanId(),
    canvasOrigin: origin,
    url: actualUrlForNode(node),
    title: node.title,
    courseHint: node.metadata?.courseTitle || null,
    pageKindHint: apiContent.apiSource,
    apiSource: apiContent.apiSource,
    nodeId: node.id,
    contentHtml: apiContent.contentHtml,
    links: [],
    capturedAt: new Date().toISOString(),
  }
}

async function extractStoredFile(appBaseUrl, extensionToken, nodeId) {
  return postJson(appBaseUrl, extensionToken, "/api/integrations/canvas/extension/extract-stored-file", { nodeId })
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
      phase: "import",
      nodeId: node.id,
      message: `Importing ${index + 1}/${nodes.length}: ${node.title}`,
      result: { currentNodeId: node.id, importedCount: importedNodes.length, totalCount: nodes.length },
      details: { current: index + 1, total: nodes.length, kind: node.kind, url: node.url },
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
        // The stored file is extracted server-side on import; it also marks the node imported,
        // so we don't push it into importedNodes (which would overwrite that linkage).
        const result = await extractStoredFile(context.appBaseUrl, context.extensionToken, node.id)
        ledger.push({
          url: node.url,
          status: "imported",
          reason: result?.extracted ? `Read file (${result.candidateCount ?? 0} item(s) for Jarvis).` : (result?.reason || "File stored."),
          candidateCount: result?.candidateCount ?? 0,
        })
        await reportCommand(context.appBaseUrl, context.extensionToken, {
          commandId: command.id,
          status: "progress",
          level: "success",
          phase: "imported",
          nodeId: node.id,
          message: `Imported ${node.title}.`,
          details: { url: node.url, candidateCount: result?.candidateCount ?? 0 },
        })
        continue
      }

      const origin = node.canvasOrigin
      let apiContent = null
      try {
        apiContent = await fetchNodeApiContent(origin, node)
      } catch {
        apiContent = null
      }

      let result
      if (apiContent && apiContent.contentHtml && apiContent.contentHtml.trim()) {
        result = await importPage(context.appBaseUrl, context.extensionToken, apiContentPayload(node, origin, apiContent))
      } else {
        const tab = await findCanvasTab(origin, context.appBaseUrl)
        if (!tab?.id) throw new Error("Open the matching Canvas site before importing selected nodes.")
        const snapshot = await navigateNodeAndCollect(tab, node, randomScanId())

        if (looksLikeActiveAssessment({ url: snapshot.url, title: snapshot.title, text: snapshot.visibleText })) {
          ledger.push({ url: node.url, status: "skipped", reason: "Active quiz or timed assessment surface.", candidateCount: 0 })
          await reportCommand(context.appBaseUrl, context.extensionToken, {
            commandId: command.id,
            status: "progress",
            level: "warning",
            phase: "import_skip",
            nodeId: node.id,
            message: `Skipped active assessment surface: ${node.title}`,
            details: { url: snapshot.url },
          })
          continue
        }

        result = await importPage(context.appBaseUrl, context.extensionToken, snapshot)
      }

      importedNodes.push({
        nodeId: node.id,
        sourceSnapshotId: result.sourceSnapshotId,
        sourceFileId: null,
        importedAt: new Date().toISOString(),
      })
      ledger.push(result.ledgerItem)
      await reportCommand(context.appBaseUrl, context.extensionToken, {
        commandId: command.id,
        status: "progress",
        level: "success",
        phase: "imported",
        nodeId: node.id,
        message: `Imported ${node.title}.`,
        details: result.ledgerItem,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown Canvas import failure."
      ledger.push({
        url: node.url,
        status: "failed",
        reason,
        candidateCount: 0,
      })
      await reportCommand(context.appBaseUrl, context.extensionToken, {
        commandId: command.id,
        status: "progress",
        level: "error",
        phase: "import",
        nodeId: node.id,
        message: `Failed to import ${node.title}: ${reason}`,
        details: { url: node.url, reason },
      })
    }
  }

  await reportCommand(context.appBaseUrl, context.extensionToken, {
    commandId: command.id,
    status: "succeeded",
    level: "success",
    phase: "import_complete",
    message: `Imported ${importedNodes.length} Canvas node(s).`,
    importedNodes,
    result: { importedCount: importedNodes.length, totalCount: nodes.length, ledger },
  })
}

async function syncContent(appBaseUrl, extensionToken, payload) {
  return postJson(appBaseUrl, extensionToken, "/api/integrations/canvas/extension/sync-content", payload)
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

// Resolve a module item to a canonical content URL so clicking it in the Modules doc routes
// through in-app capture (Canvas item html_urls are /modules/items/:id redirects).
function canonicalModuleItemUrl(item, origin, courseId) {
  switch (item.type) {
    case "Page":
      return item.page_url ? `${origin}/courses/${courseId}/pages/${item.page_url}` : item.html_url || null
    case "Assignment":
      return item.content_id ? `${origin}/courses/${courseId}/assignments/${item.content_id}` : item.html_url || null
    case "Discussion":
      return item.content_id ? `${origin}/courses/${courseId}/discussion_topics/${item.content_id}` : item.html_url || null
    case "File":
      return item.content_id ? `${origin}/courses/${courseId}/files/${item.content_id}` : item.html_url || null
    case "ExternalUrl":
    case "ExternalTool":
      return item.external_url || item.html_url || null
    default:
      return item.html_url || item.external_url || null
  }
}

async function fetchCourseContentItems(origin, courseId) {
  const items = []
  const seen = new Set()
  const add = (item) => {
    if (!item?.url || !item.contentHtml || seen.has(item.url)) return
    seen.add(item.url)
    items.push(item)
  }

  // The front page is itself a wiki page; track its slug so we don't list it twice.
  let homePageSlug = null

  try {
    const home = await canvasApiFetch(origin, `/api/v1/courses/${courseId}/front_page`)
    if (home?.body) {
      add({
        url: `${origin}/courses/${courseId}?jarvis_tab=home`,
        title: home.title || "Home",
        kind: "page",
        apiSource: "front_page",
        contentHtml: home.body,
      })
      homePageSlug = typeof home.url === "string" ? home.url : null
    }
  } catch {
    // No wiki front page for this course.
  }

  try {
    const course = await canvasApiFetch(origin, `/api/v1/courses/${courseId}`, { "include[]": ["syllabus_body"] })
    add({
      url: `${origin}/courses/${courseId}/assignments/syllabus`,
      title: "Syllabus",
      kind: "page",
      apiSource: "syllabus",
      contentHtml: course?.syllabus_body ?? null,
    })
  } catch {
    // Syllabus unavailable.
  }

  try {
    const pages = await canvasApiFetchAll(origin, `/api/v1/courses/${courseId}/pages`)
    for (const page of pages) {
      if (!page?.url) continue
      if (homePageSlug && page.url === homePageSlug) continue
      let body = page.body
      if (body === undefined || body === null) {
        try {
          const full = await canvasApiFetch(origin, `/api/v1/courses/${courseId}/pages/${encodeURIComponent(page.url)}`)
          body = full?.body ?? null
        } catch {
          body = null
        }
      }
      add({
        url: page.html_url || `${origin}/courses/${courseId}/pages/${page.url}`,
        title: page.title || page.url,
        kind: "page",
        apiSource: "page",
        contentHtml: body ?? null,
      })
    }
  } catch {
    // Pages tab unavailable.
  }

  try {
    const assignments = await canvasApiFetchAll(origin, `/api/v1/courses/${courseId}/assignments`)
    for (const assignment of assignments) {
      if (!assignment?.id) continue
      add({
        url: assignment.html_url || `${origin}/courses/${courseId}/assignments/${assignment.id}`,
        title: assignment.name || `Assignment ${assignment.id}`,
        kind: "assignment",
        apiSource: "assignment",
        contentHtml: assignment.description ?? null,
        dueAt: assignment.due_at ?? null,
      })
    }
  } catch {
    // Assignments tab unavailable.
  }

  try {
    const announcements = await canvasApiFetchAll(origin, "/api/v1/announcements", { "context_codes[]": [`course_${courseId}`] })
    for (const topic of announcements) {
      if (!topic?.id) continue
      add({
        url: topic.html_url || `${origin}/courses/${courseId}/announcements/${topic.id}`,
        title: topic.title || `Announcement ${topic.id}`,
        kind: "discussion",
        apiSource: "announcement",
        contentHtml: topic.message ?? null,
      })
    }
  } catch {
    // Announcements unavailable.
  }

  try {
    const topics = await canvasApiFetchAll(origin, `/api/v1/courses/${courseId}/discussion_topics`)
    for (const topic of topics) {
      if (!topic?.id) continue
      add({
        url: topic.html_url || `${origin}/courses/${courseId}/discussion_topics/${topic.id}`,
        title: topic.title || `Discussion ${topic.id}`,
        kind: "discussion",
        apiSource: "discussion",
        contentHtml: topic.message ?? null,
      })
    }
  } catch {
    // Discussions unavailable.
  }

  // A synthesized "Modules" overview: lists each module's items as links (pages,
  // assignments, files, external readings) so file-backed readings stay accessible.
  try {
    const modules = await canvasApiFetchAll(origin, `/api/v1/courses/${courseId}/modules`, { "include[]": ["items"] })
    const sections = modules
      .map((moduleEntry) => {
        const itemsHtml = (moduleEntry.items || [])
          .map((item) => {
            const label = escapeHtml(item.title || "Item")
            if (item.type === "SubHeader") return `<li><strong>${label}</strong></li>`
            const href = canonicalModuleItemUrl(item, origin, courseId)
            return href ? `<li><a href="${escapeHtml(href)}">${label}</a></li>` : `<li>${label}</li>`
          })
          .join("")
        if (!itemsHtml) return ""
        return `<h2>${escapeHtml(moduleEntry.name || "Module")}</h2><ul>${itemsHtml}</ul>`
      })
      .filter(Boolean)
      .join("")

    add({
      url: `${origin}/courses/${courseId}/modules?jarvis_doc=modules`,
      title: "Modules",
      kind: "module",
      apiSource: "module",
      contentHtml: sections || null,
    })
  } catch {
    // Modules unavailable.
  }

  return items.slice(0, 400)
}

const MAX_VIEW_FILE_BYTES = 50 * 1024 * 1024

// Types we download + store for inline viewing. Media (video/audio), archives, and oversized
// files become note nodes with a Canvas link instead of being downloaded.
function isStorableViewType(mimeType, fileName) {
  const type = (mimeType || "").toLowerCase()
  const name = (fileName || "").toLowerCase()
  if (type.includes("pdf") || name.endsWith(".pdf")) return true
  if (type.startsWith("image/")) return true
  if (type.includes("officedocument.wordprocessingml") || name.endsWith(".docx")) return true
  if (type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) return true
  return false
}

async function postForm(appBaseUrl, extensionToken, path, formData) {
  const response = await fetch(`${normalizeJarvisAppBaseUrl(appBaseUrl)}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${extensionToken}` },
    body: formData,
  })
  const payload = await response.json().catch(() => null)

  if (!response.ok || !payload) {
    throw new Error(payload?.details || payload?.error || `Canvas file content request failed (${response.status}).`)
  }

  return payload
}

async function executeSyncCourse(command, context) {
  const courseNode = context.nodes.find((node) => node.id === command.targetNodeId)
  if (!courseNode) throw new Error("Canvas course was not included with sync command.")
  if (courseNode.kind !== "course") throw new Error("Sync can only run on a Canvas course.")
  const origin = courseNode.canvasOrigin
  const courseId = courseNode.metadata?.courseId || courseIdFor(courseNode.url)
  if (!courseId) throw new Error("Missing Canvas course id for sync.")

  await reportCommand(context.appBaseUrl, context.extensionToken, {
    commandId: command.id,
    status: "progress",
    phase: "sync",
    nodeId: courseNode.id,
    message: `Loading all content for ${courseNode.title} from the Canvas API.`,
  })

  const items = await fetchCourseContentItems(origin, courseId)

  const result = await syncContent(context.appBaseUrl, context.extensionToken, {
    scanId: randomScanId(),
    canvasOrigin: origin,
    courseUrl: courseNode.url,
    courseId: String(courseId),
    courseTitle: courseNode.title,
    items,
  })

  await reportCommand(context.appBaseUrl, context.extensionToken, {
    commandId: command.id,
    status: "succeeded",
    level: "success",
    phase: "sync_complete",
    nodeId: courseNode.id,
    message: `Synced ${result.nodeCount} item(s) (${result.contentCount} readable) for ${courseNode.title}.`,
    result: {
      nodeCount: result.nodeCount,
      contentCount: result.contentCount,
      courseNodeId: courseNode.id,
      via: "api",
    },
  })
}

async function executeCommand(command, context) {
  await setLastCommand(command, "running")

  if (command.type === "discover") {
    await executeDiscover(command, context)
  } else if (command.type === "expand_node") {
    await executeExpandNode(command, context)
  } else if (command.type === "sync_course") {
    await executeSyncCourse(command, context)
  } else if (command.type === "import_selected") {
    await executeImportSelected(command, context)
  } else if (command.type === "capture_url") {
    await executeCaptureUrl(command, context)
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
        level: "error",
        phase: "failed",
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

// Top-level (survives service-worker restarts): when an interactive-login tab reaches its
// reading, capture it and close the tab. Pending state lives in chrome.storage, so this works
// even if the worker was unloaded while the user signed in.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || typeof changeInfo.url === "string") {
    maybeCompleteInteractiveLogin(tabId, tab).catch(() => {})
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  storageGet([STORAGE_KEYS.pendingLogins])
    .then((store) => {
      const pending = store[STORAGE_KEYS.pendingLogins] || {}
      if (pending[String(tabId)]) {
        delete pending[String(tabId)]
        return storageSet({ [STORAGE_KEYS.pendingLogins]: pending })
      }
      return undefined
    })
    .catch(() => {})
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

    const state = await storageGet([STORAGE_KEYS.appBaseUrl, STORAGE_KEYS.extensionToken, STORAGE_KEYS.lastCommand, STORAGE_KEYS.lastError])
    return {
      success: true,
      paired: Boolean(state[STORAGE_KEYS.appBaseUrl] && state[STORAGE_KEYS.extensionToken]),
      appBaseUrl: state[STORAGE_KEYS.appBaseUrl] || null,
      lastCommand: state[STORAGE_KEYS.lastCommand] || null,
      lastError: state[STORAGE_KEYS.lastError] || null,
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

    const state = await storageGet([STORAGE_KEYS.appBaseUrl, STORAGE_KEYS.extensionToken, STORAGE_KEYS.lastCommand, STORAGE_KEYS.lastError])
    return {
      success: true,
      paired: Boolean(state[STORAGE_KEYS.appBaseUrl] && state[STORAGE_KEYS.extensionToken]),
      appBaseUrl: state[STORAGE_KEYS.appBaseUrl] || null,
      lastCommand: state[STORAGE_KEYS.lastCommand] || null,
      lastError: state[STORAGE_KEYS.lastError] || null,
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
