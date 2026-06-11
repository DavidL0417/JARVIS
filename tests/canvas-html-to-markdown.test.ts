import { describe, expect, it } from "vitest"

import { canvasHtmlToMarkdown, webpageHtmlToMarkdown } from "@/lib/sources/canvas-html-to-markdown"

const ORIGIN = "https://canvas.northwestern.edu"

describe("canvasHtmlToMarkdown", () => {
  it("returns empty markdown for blank input", () => {
    expect(canvasHtmlToMarkdown(null, { origin: ORIGIN })).toEqual({ markdown: "", truncated: false })
    expect(canvasHtmlToMarkdown("   ", { origin: ORIGIN })).toEqual({ markdown: "", truncated: false })
  })

  it("resolves root-relative Canvas links to absolute URLs", () => {
    const { markdown } = canvasHtmlToMarkdown('<p><a href="/courses/123/pages/syllabus">Syllabus</a></p>', {
      origin: ORIGIN,
    })
    expect(markdown).toContain("https://canvas.northwestern.edu/courses/123/pages/syllabus")
    expect(markdown).not.toMatch(/\]\(\/courses/)
  })

  it("leaves already-absolute and anchor links untouched", () => {
    const { markdown } = canvasHtmlToMarkdown(
      '<a href="https://panopto.com/v/1">Video</a> <a href="#top">Top</a>',
      { origin: ORIGIN },
    )
    expect(markdown).toContain("https://panopto.com/v/1")
    expect(markdown).toContain("#top")
    expect(markdown).not.toContain("northwestern.edu/#top")
  })

  it("strips script/style/iframe and inline event handlers", () => {
    const { markdown } = canvasHtmlToMarkdown(
      '<script>alert(1)</script><style>.x{}</style><iframe src="/evil"></iframe><p onclick="steal()">Hello</p>',
      { origin: ORIGIN },
    )
    expect(markdown).toContain("Hello")
    expect(markdown).not.toContain("alert(1)")
    expect(markdown).not.toContain("steal()")
    expect(markdown.toLowerCase()).not.toContain("<iframe")
  })

  it("converts headings, lists, and emphasis", () => {
    const { markdown } = canvasHtmlToMarkdown(
      "<h1>Welcome</h1><ul><li><strong>One</strong></li><li>Two</li></ul>",
      { origin: ORIGIN },
    )
    expect(markdown).toContain("# Welcome")
    expect(markdown).toContain("**One**")
    expect(markdown).toContain("Two")
  })

  it("truncates very long content and flags it", () => {
    const longHtml = `<p>${"word ".repeat(20000)}</p>`
    const result = canvasHtmlToMarkdown(longHtml, { origin: ORIGIN })
    expect(result.truncated).toBe(true)
    expect(result.markdown.length).toBeLessThanOrEqual(50_100)
    expect(result.markdown).toContain("content truncated")
  })
})

describe("webpageHtmlToMarkdown", () => {
  const SITE = "https://www.jstor.org"

  it("drops page chrome and keeps the main article", () => {
    const html = `<!doctype html><html><head><title>Ignore me</title><style>.x{}</style></head>
      <body>
        <nav><a href="/browse">Browse</a><a href="/login">Log in</a></nav>
        <header>Site header junk</header>
        <main><h1>Moral Passage</h1><p>The symbolic process in public designations of deviance.</p></main>
        <footer>Copyright junk</footer>
      </body></html>`
    const { markdown } = webpageHtmlToMarkdown(html, { origin: SITE })
    expect(markdown).toContain("Moral Passage")
    expect(markdown).toContain("symbolic process")
    expect(markdown).not.toContain("Browse")
    expect(markdown).not.toContain("Site header junk")
    expect(markdown).not.toContain("Copyright junk")
  })

  it("resolves relative links against the page's own origin, not Canvas", () => {
    const html = "<body><article><p><a href=\"/stable/799511\">Full text</a></p></article></body>"
    const { markdown } = webpageHtmlToMarkdown(html, { origin: SITE })
    expect(markdown).toContain("https://www.jstor.org/stable/799511")
    expect(markdown).not.toContain("northwestern.edu/stable")
  })

  it("falls back to body when there is no article/main", () => {
    const html = "<body><div><p>Plain page body content.</p></div></body>"
    const { markdown } = webpageHtmlToMarkdown(html, { origin: SITE })
    expect(markdown).toContain("Plain page body content.")
  })

  it("returns empty for blank input", () => {
    expect(webpageHtmlToMarkdown("", { origin: SITE })).toEqual({ markdown: "", truncated: false })
  })
})
