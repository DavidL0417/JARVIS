const MAX_VISIBLE_TEXT_CHARS = 60000

function cleanText(value) {
  return (value || "").replace(/\s+/g, " ").trim()
}

function visibleTextFor(element) {
  const clone = element.cloneNode(true)

  clone.querySelectorAll("script, style, noscript, iframe, input, textarea, select, button").forEach((node) => node.remove())
  return cleanText(clone.innerText || clone.textContent || "").slice(0, MAX_VISIBLE_TEXT_CHARS)
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
    capturedAt: new Date().toISOString(),
  })

  return true
})
