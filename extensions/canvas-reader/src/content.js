if (window.__JARVIS_CANVAS_READER_LOADED__) {
  // Content script already injected into this page; the existing message listener
  // keeps handling collection, so skip re-running to avoid redeclaring top-level consts.
} else {
  window.__JARVIS_CANVAS_READER_LOADED__ = true

const MAX_VISIBLE_TEXT_CHARS = 60000
const MAX_PREVIEW_HTML_CHARS = 120000
const MAX_PREVIEW_LINKS = 120
const MAX_PREVIEW_BLOCKS = 60
const MAX_BLOCK_HTML_CHARS = 60000
const MAX_BLOCK_TEXT_CHARS = 16000
const SECTION_HEADING_SELECTOR = "h1, h2, h3, h4"

function cleanText(value) {
  return (value || "").replace(/\s+/g, " ").trim()
}

function visibleTextFor(element) {
  const clone = element.cloneNode(true)

  clone.querySelectorAll("script, style, noscript, iframe, input, textarea, select, button").forEach((node) => node.remove())
  return cleanText(clone.innerText || clone.textContent || "").slice(0, MAX_VISIBLE_TEXT_CHARS)
}

function previewRoot() {
  const selectors = [
    "#content",
    ".ic-Layout-contentMain",
    "[role='main']",
    "main",
    ".show-content",
    "#wiki_page_show",
    document.body ? "body" : "",
  ].filter(Boolean)

  for (const selector of selectors) {
    const element = document.querySelector(selector)
    if (element && visibleTextFor(element).length > 0) return element
  }

  return document.body
}

function isSafePreviewUrl(url) {
  const pathname = url.pathname.toLowerCase()
  const search = url.search.toLowerCase()

  if (url.origin !== location.origin) return false
  if (/\/quizzes\/[^/]+\/take(\/|$)/.test(pathname)) return false
  if (/\/quizzes\/[^/]+\/questions(\/|$)/.test(pathname)) return false
  if (/\/assignments\/[^/]+\/submissions\/new(\/|$)/.test(pathname)) return false
  if (/\/discussion_topics\/[^/]+\/replies(\/|$)/.test(pathname)) return false
  if (/\/conversations(\/|$)/.test(pathname)) return false
  if (/\/accounts(\/|$)/.test(pathname)) return false
  if (/[?&](submit|preview|take_quiz|download)=/i.test(search)) return false

  return true
}

function sanitizeClone(source, options = {}) {
  const clone = source.cloneNode(true)
  const links = []
  const seenLinks = new Set()
  const linkLimit = options.linkLimit || MAX_PREVIEW_LINKS

  clone.querySelectorAll("script, style, link, noscript, iframe, object, embed, canvas, svg, form, input, textarea, select, button").forEach((node) => node.remove())

  for (const element of Array.from(clone.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()

      if (
        name.startsWith("on") ||
        ["src", "srcset", "srcdoc", "poster", "style", "formaction", "action", "target", "download"].includes(name)
      ) {
        element.removeAttribute(attribute.name)
      }
    }

    if (element.tagName === "A") {
      const href = element.getAttribute("href")
      const text = cleanText(element.textContent || element.getAttribute("aria-label") || "")

      try {
        const url = new URL(href || "", location.href)
        url.hash = ""

        if (!["https:", "http:"].includes(url.protocol) || !isSafePreviewUrl(url)) {
          element.removeAttribute("href")
          element.setAttribute("aria-disabled", "true")
          continue
        }

        const value = url.toString()
        element.setAttribute("href", "#")
        element.setAttribute("data-jarvis-canvas-url", value)
        element.setAttribute("role", "button")

        if (!seenLinks.has(value) && links.length < linkLimit) {
          seenLinks.add(value)
          links.push({
            url: value,
            text: text ? text.slice(0, 180) : null,
          })
        }
      } catch {
        element.removeAttribute("href")
        element.setAttribute("aria-disabled", "true")
      }
    }
  }

  return {
    html: clone.innerHTML || cleanText(source.textContent || ""),
    links,
    text: cleanText(clone.innerText || clone.textContent || ""),
  }
}

function slugFor(value, fallback) {
  const slug = cleanText(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)

  return slug || fallback
}

function blockRootFor(root) {
  const selectors = [
    "#wiki_page_show",
    ".show-content",
    ".user_content",
    "#course_syllabus",
    "[data-testid='wiki-page-content']",
  ]

  for (const selector of selectors) {
    const element = root.querySelector?.(selector)
    if (element && visibleTextFor(element).length > 0) return element
  }

  return root
}

function blockTitleFor(elements) {
  for (const element of elements) {
    if (element.matches?.(SECTION_HEADING_SELECTOR)) {
      const text = cleanText(element.textContent || "")
      if (text) return text.slice(0, 180)
    }

    const heading = element.querySelector?.(SECTION_HEADING_SELECTOR)
    const text = cleanText(heading?.textContent || "")
    if (text) return text.slice(0, 180)
  }

  return null
}

function typeForBlock(elements, text, links) {
  const tableWithLinks = elements.some((element) => element.matches?.("table") || Boolean(element.querySelector?.("table a[href]")))
  const listWithLinks = elements.some((element) => element.matches?.("ul, ol") || Boolean(element.querySelector?.("ul a[href], ol a[href]")))
  const linkTextLength = links.reduce((total, link) => total + (link.text?.length || 0), 0)
  const density = text.length > 0 ? linkTextLength / text.length : 0

  if (links.length >= 3 && (tableWithLinks || listWithLinks || density > 0.24 || text.length < 1200)) return "links"
  if (links.length >= 2 && text.length > 500) return "mixed"
  return "text"
}

function blockFromElements(elements, order) {
  const wrapper = document.createElement("section")

  for (const element of elements) {
    wrapper.append(element.cloneNode(true))
  }

  const sanitized = sanitizeClone(wrapper, { linkLimit: 80 })
  const text = sanitized.text.slice(0, MAX_BLOCK_TEXT_CHARS)
  const title = blockTitleFor(elements)
  const html = sanitized.html.slice(0, MAX_BLOCK_HTML_CHARS)

  if (!text && sanitized.links.length === 0) return null

  return {
    id: `block-${order}-${slugFor(title || text.slice(0, 80), "section")}`,
    type: typeForBlock(elements, text, sanitized.links),
    title,
    text: text || null,
    html: html || null,
    links: sanitized.links,
    order,
    truncated: sanitized.html.length > MAX_BLOCK_HTML_CHARS || sanitized.text.length > MAX_BLOCK_TEXT_CHARS,
  }
}

function candidateBlockSections(root) {
  const blockRoot = blockRootFor(root)
  const children = Array.from(blockRoot.children).filter((element) => cleanText(element.textContent || "") || element.querySelector?.("a[href]"))
  const sections = []
  let current = []

  for (const child of children) {
    const isHeading = child.matches(SECTION_HEADING_SELECTOR)
    const childHasHeading = !isHeading && child.querySelector?.(`:scope > ${SECTION_HEADING_SELECTOR}`)
    const shouldStartSection = (isHeading || childHasHeading) && current.length > 0

    if (shouldStartSection) {
      sections.push(current)
      current = []
    }

    current.push(child)

    if ((child.matches("table") || child.matches("ul, ol")) && child.querySelectorAll("a[href]").length >= 3) {
      sections.push(current)
      current = []
    }
  }

  if (current.length > 0) sections.push(current)
  if (sections.length > 0) return sections

  return [[blockRoot]]
}

function previewBlocks(root) {
  const blocks = []

  for (const section of candidateBlockSections(root)) {
    if (blocks.length >= MAX_PREVIEW_BLOCKS) break
    const block = blockFromElements(section, blocks.length)
    if (block) blocks.push(block)
  }

  if (blocks.length > 0) return blocks

  const fallback = blockFromElements([root], 0)
  return fallback ? [fallback] : []
}

function sanitizePreviewHtml() {
  const root = previewRoot()
  const sanitized = sanitizeClone(root)
  const html = sanitized.html

  return {
    html: html.slice(0, MAX_PREVIEW_HTML_CHARS),
    links: sanitized.links,
    blocks: previewBlocks(root),
    capturedAt: new Date().toISOString(),
    truncated: html.length > MAX_PREVIEW_HTML_CHARS,
  }
}

function courseHint() {
  const candidates = [
    document.querySelector(".ic-app-course-menu .ellipsible"),
    document.querySelector("[data-testid='course-header-title']"),
    document.querySelector(".course-title"),
    document.querySelector("h1"),
    document.querySelector("title"),
  ]

  for (const candidate of candidates) {
    const text = cleanText(candidate?.textContent || "")
    if (text) return text.slice(0, 180)
  }

  return null
}

function classifyPageKind() {
  const pathname = location.pathname.toLowerCase()
  const title = document.title.toLowerCase()

  if (pathname.includes("/assignments")) return "assignment"
  if (pathname.includes("/modules")) return "module"
  if (pathname.includes("/assignments/syllabus") || pathname.includes("/syllabus")) return "syllabus"
  if (pathname.includes("/discussion_topics")) return "discussion"
  if (pathname.includes("/files")) return "file"
  if (pathname.includes("/pages")) return "page"
  if (pathname.includes("/calendar")) return "calendar"
  if (title.includes("dashboard")) return "dashboard"
  if (pathname.includes("/courses/")) return "course"

  return "canvas"
}

function visibleLinks() {
  return linksFromAnchors(Array.from(document.querySelectorAll("a[href]")), 250)
}

function linksFromAnchors(anchors, limit) {
  const links = []
  const seen = new Set()

  for (const anchor of anchors) {
    const rect = anchor.getBoundingClientRect()
    const text = cleanText(anchor.textContent || anchor.getAttribute("aria-label") || "")
    const href = anchor.getAttribute("href")

    if (!href || rect.width === 0 || rect.height === 0) continue

    try {
      const url = new URL(href, location.href)
      url.hash = ""

      if (!["https:", "http:"].includes(url.protocol)) continue
      if (url.origin !== location.origin) continue
      if (seen.has(url.toString())) continue
      seen.add(url.toString())
      links.push({
        url: url.toString(),
        text: text ? text.slice(0, 180) : null,
        kindHint: null,
      })
    } catch {
      // Ignore malformed links.
    }
  }

  return links.slice(0, limit)
}

function courseNavigationLinks() {
  const selectors = [
    ".ic-app-course-menu a[href]",
    "#section-tabs a[href]",
    "[aria-label='Course Navigation'] a[href]",
    "[aria-label='Course navigation'] a[href]",
    ".course_navigation a[href]",
  ]
  const anchors = []
  const seen = new Set()

  for (const selector of selectors) {
    for (const anchor of Array.from(document.querySelectorAll(selector))) {
      if (seen.has(anchor)) continue
      seen.add(anchor)
      anchors.push(anchor)
    }
  }

  return linksFromAnchors(anchors, 100)
}

function isCourseNavigationAnchor(anchor) {
  return Boolean(anchor.closest(".ic-app-course-menu, #section-tabs, [aria-label='Course Navigation'], [aria-label='Course navigation'], .course_navigation"))
}

function pageItemLinks() {
  return linksFromAnchors(Array.from(document.querySelectorAll("a[href]")).filter((anchor) => !isCourseNavigationAnchor(anchor)), 250)
}

function headingBefore(element) {
  let current = element

  while (current) {
    let sibling = current.previousElementSibling

    while (sibling) {
      if (/^H[1-3]$/.test(sibling.tagName)) {
        const text = cleanText(sibling.textContent || "")
        if (text) return text.slice(0, 120)
      }

      sibling = sibling.previousElementSibling
    }

    current = current.parentElement
  }

  return "All Courses"
}

function tableColumnValue(headers, cells, names) {
  for (const name of names) {
    const index = headers.findIndex((header) => header.includes(name))
    if (index >= 0 && cells[index]) return cleanText(cells[index].textContent || "")
  }

  return null
}

function canvasCourseRows() {
  const rows = []
  const seen = new Set()

  for (const table of Array.from(document.querySelectorAll("table"))) {
    const headers = Array.from(table.querySelectorAll("thead th")).map((header) => cleanText(header.textContent || "").toLowerCase())
    const group = headingBefore(table)

    for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
      const cells = Array.from(row.querySelectorAll("td"))
      const courseAnchor = Array.from(row.querySelectorAll("a[href]")).find((anchor) => {
        try {
          const url = new URL(anchor.getAttribute("href") || "", location.href)
          return url.origin === location.origin && /^\/courses\/\d+\/?$/.test(url.pathname) && cleanText(anchor.textContent || "")
        } catch {
          return false
        }
      })

      if (!courseAnchor) continue

      try {
        const url = new URL(courseAnchor.getAttribute("href") || "", location.href)
        const courseId = url.pathname.match(/^\/courses\/(\d+)\/?$/)?.[1]
        if (!courseId || seen.has(courseId)) continue
        seen.add(courseId)

        rows.push({
          url: `${url.origin}/courses/${courseId}`,
          title: cleanText(courseAnchor.textContent || `Course ${courseId}`).slice(0, 240),
          courseId,
          group,
          term: tableColumnValue(headers, cells, ["term"]),
          enrolledAs: tableColumnValue(headers, cells, ["enrolled as", "enrollment"]),
          published: tableColumnValue(headers, cells, ["published"]),
        })
      } catch {
        // Ignore malformed Canvas course links.
      }
    }
  }

  return rows.slice(0, 500)
}

function addReadOnlyGuards() {
  if (window.__jarvisCanvasReadOnlyGuardsInstalled) return
  window.__jarvisCanvasReadOnlyGuardsInstalled = true

  document.addEventListener("submit", (event) => {
    if (window.__jarvisCanvasScanActive) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }, true)

  document.addEventListener("click", (event) => {
    if (!window.__jarvisCanvasScanActive) return

    const target = event.target instanceof Element ? event.target : null
    const formControl = target?.closest("button, input[type='submit'], input[type='button'], textarea, select")

    if (formControl) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }, true)
}

addReadOnlyGuards()

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "JARVIS_PING_CANVAS_READER") {
    sendResponse({ ok: true })
    return false
  }

  if (!message || message.type !== "JARVIS_COLLECT_CANVAS_PAGE") {
    return false
  }

  window.__jarvisCanvasScanActive = true

  sendResponse({
    scanId: message.scanId,
    canvasOrigin: location.origin,
    url: location.href,
    title: document.title || cleanText(document.querySelector("h1")?.textContent || "Canvas"),
    courseHint: courseHint(),
    pageKindHint: classifyPageKind(),
    visibleText: visibleTextFor(document.body) || cleanText(document.title || location.pathname || "Canvas page"),
    links: visibleLinks(),
    courseNavLinks: courseNavigationLinks(),
    pageItemLinks: pageItemLinks(),
    courseRows: canvasCourseRows(),
    pagePreview: sanitizePreviewHtml(),
    capturedAt: new Date().toISOString(),
  })

  return true
})

}
