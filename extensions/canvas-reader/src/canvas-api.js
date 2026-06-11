import { classifyCanvasNodeKind, MAX_PAGES_PER_SCAN } from "./guardrails.js"

const RATE_LIMIT_MIN_REMAINING = 50
const MAX_RATE_LIMIT_RETRIES = 3

export class CanvasApiError extends Error {
  constructor(message, { status = 0, rateLimited = false } = {}) {
    super(message)
    this.name = "CanvasApiError"
    this.status = status
    this.rateLimited = rateLimited
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildUrl(origin, path, searchParams) {
  const url = new URL(path, origin)

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null) continue
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item))
      } else {
        url.searchParams.set(key, String(value))
      }
    }
  }

  return url.toString()
}

function nextLink(linkHeader) {
  if (!linkHeader) return null
  const next = linkHeader
    .split(",")
    .map((part) => part.trim())
    .find((part) => /rel="next"/.test(part))
  return next ? next.match(/<([^>]+)>/)?.[1] ?? null : null
}

async function rawFetch(url) {
  let attempt = 0

  while (true) {
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    })

    if (response.status === 403) {
      const body = await response.clone().text().catch(() => "")
      const rateLimited = /rate limit/i.test(body)
      if (rateLimited && attempt < MAX_RATE_LIMIT_RETRIES) {
        await sleep(1000 * 2 ** attempt)
        attempt += 1
        continue
      }
      throw new CanvasApiError(`Canvas API request was forbidden (403).`, { status: 403, rateLimited })
    }

    if (!response.ok) {
      throw new CanvasApiError(`Canvas API request failed (${response.status}).`, { status: response.status })
    }

    const remaining = Number(response.headers.get("X-Rate-Limit-Remaining"))
    if (!Number.isNaN(remaining) && remaining < RATE_LIMIT_MIN_REMAINING) {
      await sleep(400)
    }

    return response
  }
}

export async function canvasApiFetch(origin, path, searchParams) {
  const response = await rawFetch(buildUrl(origin, path, searchParams))
  return response.json()
}

export async function canvasApiFetchAll(origin, path, searchParams) {
  let url = buildUrl(origin, path, { per_page: 100, ...searchParams })
  const items = []
  let pages = 0

  while (url && pages < MAX_PAGES_PER_SCAN) {
    const response = await rawFetch(url)
    const batch = await response.json()
    if (Array.isArray(batch)) {
      items.push(...batch)
    } else if (batch) {
      items.push(batch)
    }
    url = nextLink(response.headers.get("Link"))
    pages += 1
  }

  return items
}

function absoluteUrl(origin, rawUrl) {
  if (!rawUrl) return null
  return /^https?:\/\//i.test(rawUrl) ? rawUrl : `${origin}${rawUrl}`
}

function disambiguateTabUrl(absolute, parentUrl, title) {
  if (absolute !== parentUrl) return absolute
  const slug = (title || "home").toLowerCase().replace(/[^a-z0-9]+/g, "_") || "home"
  return `${absolute}?jarvis_tab=${encodeURIComponent(slug)}`
}

// Canvas course tab ids that import directly as a single content page.
const SINGLE_PAGE_TAB_API_SOURCE = {
  home: "front_page",
  syllabus: "syllabus",
}

export function courseToNode(course, origin) {
  const courseId = String(course.id)
  const term = course.term?.name || null

  return {
    parentUrl: null,
    canvasOrigin: origin,
    url: `${origin}/courses/${courseId}`,
    title: (course.name || course.course_code || `Course ${courseId}`).slice(0, 240),
    kind: "course",
    textPreview: [course.course_code, term].filter(Boolean).join(" · ") || null,
    metadata: {
      level: "course",
      courseId,
      term,
      courseCode: course.course_code || null,
      defaultView: course.default_view || null,
    },
    selected: false,
  }
}

export function tabToNode(tab, parentNode, origin) {
  const courseId = parentNode.metadata?.courseId || null
  const absolute = absoluteUrl(origin, tab.full_url || tab.html_url) || parentNode.url
  const external = tab.type === "external"
  const tabId = typeof tab.id === "string" ? tab.id : String(tab.id ?? "")
  const title = (tab.label || tabId || "Canvas tab").slice(0, 240)
  const apiSource = SINGLE_PAGE_TAB_API_SOURCE[tabId] || null

  return {
    parentId: parentNode.id,
    canvasOrigin: origin,
    url: disambiguateTabUrl(absolute, parentNode.url, title),
    title,
    kind: external ? "external_link" : classifyCanvasNodeKind(absolute, title),
    textPreview: null,
    metadata: {
      level: "tab",
      sourceTab: title,
      actualUrl: absolute,
      tabId,
      tabType: tab.type || "internal",
      external,
      apiSource,
      courseId,
      courseTitle: parentNode.title,
      selectedByParent: false,
    },
    selected: false,
  }
}

function itemNode({ parentNode, origin, url, title, kind, apiSource, extra }) {
  return {
    parentId: parentNode.id,
    canvasOrigin: origin,
    url,
    title: (title || "Canvas item").slice(0, 240),
    kind,
    textPreview: null,
    metadata: {
      level: "item",
      sourceTab: parentNode.metadata?.sourceTab || parentNode.title,
      discoveredFrom: parentNode.id,
      actualUrl: url,
      apiSource,
      courseId: parentNode.metadata?.courseId || null,
      courseTitle: parentNode.metadata?.courseTitle || null,
      selectedByParent: false,
      ...extra,
    },
    selected: false,
  }
}

export function assignmentToNode(assignment, parentNode, origin) {
  const courseId = parentNode.metadata?.courseId
  const url = absoluteUrl(origin, assignment.html_url) || `${origin}/courses/${courseId}/assignments/${assignment.id}`
  return itemNode({
    parentNode,
    origin,
    url,
    title: assignment.name,
    kind: "assignment",
    apiSource: "assignment",
    extra: { assignmentId: assignment.id, dueAt: assignment.due_at || null, pointsPossible: assignment.points_possible ?? null },
  })
}

export function pageToNode(page, parentNode, origin) {
  const courseId = parentNode.metadata?.courseId
  const url = absoluteUrl(origin, page.html_url) || `${origin}/courses/${courseId}/pages/${page.url}`
  return itemNode({
    parentNode,
    origin,
    url,
    title: page.title,
    kind: "page",
    apiSource: "page",
    extra: { pageUrl: page.url },
  })
}

export function discussionToNode(topic, parentNode, origin, { announcement = false } = {}) {
  const url = absoluteUrl(origin, topic.html_url) || parentNode.url
  return itemNode({
    parentNode,
    origin,
    url,
    title: topic.title,
    kind: "discussion",
    apiSource: announcement ? "announcement" : "discussion",
    extra: { topicId: topic.id, postedAt: topic.posted_at || null },
  })
}

export function fileToNode(file, parentNode, origin) {
  const url = absoluteUrl(origin, file.url || file.html_url) || parentNode.url
  return itemNode({
    parentNode,
    origin,
    url,
    title: file.display_name || file.filename,
    kind: "file",
    apiSource: null,
    extra: { fileId: file.id, contentType: file.content_type || null, sizeBytes: file.size ?? null },
  })
}

const MODULE_ITEM_BUILDERS = {
  Page: (item, parentNode, origin) =>
    itemNode({
      parentNode,
      origin,
      url: absoluteUrl(origin, item.html_url) || parentNode.url,
      title: item.title,
      kind: "page",
      apiSource: "page",
      extra: { pageUrl: item.page_url || null, moduleItem: true },
    }),
  Assignment: (item, parentNode, origin) =>
    itemNode({
      parentNode,
      origin,
      url: absoluteUrl(origin, item.html_url) || parentNode.url,
      title: item.title,
      kind: "assignment",
      apiSource: "assignment",
      extra: { assignmentId: item.content_id, moduleItem: true },
    }),
  Discussion: (item, parentNode, origin) =>
    itemNode({
      parentNode,
      origin,
      url: absoluteUrl(origin, item.html_url) || parentNode.url,
      title: item.title,
      kind: "discussion",
      apiSource: "discussion",
      extra: { topicId: item.content_id, moduleItem: true },
    }),
  File: (item, parentNode, origin) =>
    itemNode({
      parentNode,
      origin,
      url: absoluteUrl(origin, item.html_url) || parentNode.url,
      title: item.title,
      kind: "file",
      apiSource: null,
      extra: { fileId: item.content_id, moduleItem: true },
    }),
}

export function moduleItemsToNodes(modules, parentNode, origin) {
  const nodes = []
  const seen = new Set()

  for (const moduleEntry of modules || []) {
    for (const item of moduleEntry.items || []) {
      const builder = MODULE_ITEM_BUILDERS[item.type]
      if (!builder) continue
      const node = builder(item, parentNode, origin)
      if (!node?.url || seen.has(node.url)) continue
      seen.add(node.url)
      node.metadata.moduleName = moduleEntry.name || null
      nodes.push(node)
    }
  }

  return nodes
}

/**
 * Resolves a node's API content endpoint and returns the raw HTML body, or null when
 * the node has no API-backed content (forcing the caller to use the DOM fallback).
 */
export async function fetchNodeApiContent(origin, node) {
  const meta = node.metadata || {}
  const apiSource = meta.apiSource
  const courseId = meta.courseId
  if (!apiSource || !courseId) return null

  if (apiSource === "front_page") {
    const data = await canvasApiFetch(origin, `/api/v1/courses/${courseId}/front_page`)
    return { apiSource, contentHtml: data?.body ?? null }
  }
  if (apiSource === "syllabus") {
    const data = await canvasApiFetch(origin, `/api/v1/courses/${courseId}`, { "include[]": ["syllabus_body"] })
    return { apiSource, contentHtml: data?.syllabus_body ?? null }
  }
  if (apiSource === "page" && meta.pageUrl) {
    const data = await canvasApiFetch(origin, `/api/v1/courses/${courseId}/pages/${encodeURIComponent(meta.pageUrl)}`)
    return { apiSource, contentHtml: data?.body ?? null }
  }
  if (apiSource === "assignment" && meta.assignmentId) {
    const data = await canvasApiFetch(origin, `/api/v1/courses/${courseId}/assignments/${meta.assignmentId}`)
    return { apiSource, contentHtml: data?.description ?? null }
  }
  if ((apiSource === "discussion" || apiSource === "announcement") && meta.topicId) {
    const data = await canvasApiFetch(origin, `/api/v1/courses/${courseId}/discussion_topics/${meta.topicId}`)
    return { apiSource, contentHtml: data?.message ?? null }
  }

  return null
}
