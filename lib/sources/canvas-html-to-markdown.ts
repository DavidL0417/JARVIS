import { NodeHtmlMarkdown } from "node-html-markdown"

const MAX_MARKDOWN_LENGTH = 50_000

const PAIRED_UNSAFE_PATTERN = /<(script|style|iframe|object|embed|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi
const STANDALONE_UNSAFE_PATTERN = /<(script|style|iframe|object|embed|noscript)\b[^>]*\/?>/gi
const EVENT_HANDLER_PATTERN = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi
const RELATIVE_URL_ATTR_PATTERN = /\b(href|src)\s*=\s*(["'])(\/[^/][^"']*|\/)\2/gi

export interface CanvasMarkdownResult {
  markdown: string
  truncated: boolean
}

function normalizeOrigin(value: string): string {
  try {
    return new URL(value).origin
  } catch {
    return value.replace(/\/+$/, "")
  }
}

/**
 * Converts a Canvas REST API HTML body field (page body, assignment description,
 * syllabus_body, announcement/discussion message) into sanitized markdown. Strips
 * executable/embedded markup and rewrites root-relative Canvas links to absolute URLs
 * before conversion so the rendered markdown links resolve outside the Canvas DOM.
 */
export function canvasHtmlToMarkdown(
  html: string | null | undefined,
  options: { origin: string },
): CanvasMarkdownResult {
  if (!html || !html.trim()) {
    return { markdown: "", truncated: false }
  }

  const origin = normalizeOrigin(options.origin)
  const sanitized = html
    .replace(PAIRED_UNSAFE_PATTERN, "")
    .replace(STANDALONE_UNSAFE_PATTERN, "")
    .replace(EVENT_HANDLER_PATTERN, "")
    .replace(
      RELATIVE_URL_ATTR_PATTERN,
      (_match, attr: string, quote: string, path: string) => `${attr}=${quote}${origin}${path}${quote}`,
    )

  const converted = NodeHtmlMarkdown.translate(sanitized).trim()

  if (converted.length <= MAX_MARKDOWN_LENGTH) {
    return { markdown: converted, truncated: false }
  }

  return {
    markdown: `${converted.slice(0, MAX_MARKDOWN_LENGTH).trimEnd()}\n\n_(content truncated)_`,
    truncated: true,
  }
}

// Whole-page chrome that carries no reading value and turns into markdown noise.
const PAGE_CHROME_PATTERN = /<(nav|header|footer|aside|form|button|svg|template|head)\b[^>]*>[\s\S]*?<\/\1>/gi
const ARTICLE_PATTERN = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i
const BODY_PATTERN = /<body\b[^>]*>([\s\S]*?)<\/body>/i

/**
 * Converts a full external webpage (an off-Canvas course reading: a publisher page, a
 * dictionary entry, a JSTOR article landing page) into sanitized, readable markdown.
 * Unlike a Canvas page body this is a complete document, so we first drop page chrome
 * (nav/header/footer/aside/forms) and isolate the main article when one is marked up,
 * then reuse the shared Canvas sanitization. Relative URLs resolve against the page's own
 * origin so links stay clickable.
 */
export function webpageHtmlToMarkdown(
  html: string | null | undefined,
  options: { origin: string },
): CanvasMarkdownResult {
  if (!html || !html.trim()) {
    return { markdown: "", truncated: false }
  }

  const deChromed = html.replace(PAGE_CHROME_PATTERN, "")
  const article = deChromed.match(ARTICLE_PATTERN)?.[2]
  const body = deChromed.match(BODY_PATTERN)?.[1]
  const main = (article && article.trim()) || (body && body.trim()) || deChromed

  return canvasHtmlToMarkdown(main, options)
}
