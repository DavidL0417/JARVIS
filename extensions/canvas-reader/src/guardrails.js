export const MAX_PAGES_PER_SCAN = 80
export const MAX_DEPTH = 4
export const MAX_TEXT_CHARS = 60000

const ALLOWED_PATH_PATTERNS = [
  /^\/?$/,
  /^\/dashboard\/?$/,
  /^\/calendar\/?/,
  /^\/courses(\/|$)/,
  /^\/groups(\/|$)/,
]

const BLOCKED_PATH_PATTERNS = [
  /\/quizzes\/[^/]+\/take(\/|$)/,
  /\/quizzes\/[^/]+\/questions(\/|$)/,
  /\/quiz_submissions(\/|$)/,
  /\/submissions\/[^/]+\/edit(\/|$)/,
  /\/assignments\/[^/]+\/submit(\/|$)/,
  /\/discussion_topics\/[^/]+\/replies(\/|$)/,
  /\/conversations(\/|$)/,
  /\/profile(\/|$)/,
  /\/accounts(\/|$)/,
]

const BLOCKED_QUERY_KEYS = new Set(["submit", "preview_quiz", "take_quiz"])

export function normalizeUrl(value, baseUrl) {
  try {
    const url = new URL(value, baseUrl)
    url.hash = ""
    return url.toString()
  } catch {
    return null
  }
}

export function sameOrigin(url, origin) {
  try {
    return new URL(url).origin === origin
  } catch {
    return false
  }
}

export function isAllowedCanvasUrl(url, origin) {
  let parsed

  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.origin !== origin) return false
  if (!["https:", "http:"].includes(parsed.protocol)) return false
  if (parsed.protocol === "http:" && parsed.hostname !== "localhost") return false
  if (BLOCKED_PATH_PATTERNS.some((pattern) => pattern.test(parsed.pathname))) return false

  for (const key of parsed.searchParams.keys()) {
    if (BLOCKED_QUERY_KEYS.has(key)) return false
  }

  return ALLOWED_PATH_PATTERNS.some((pattern) => pattern.test(parsed.pathname))
}

// A cross-origin web link worth pulling in as a read-only reading (an off-Canvas course
// reading). Same-origin Canvas links are handled by the Canvas-native capture path instead.
// http is accepted because Canvas often stores legacy http external_urls (e.g. JSTOR); the
// capture upgrades the scheme to https before fetching.
export function isCaptureableExternalUrl(url, canvasOrigin) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false
  if (canvasOrigin && parsed.origin === canvasOrigin) return false
  return true
}

const LOGIN_URL_PATTERN = /(\/login\b|\/log-in|\/signin|\/sign-in|\/sso\/|\bsso\.|samlsso|saml2?\/|shibboleth|\/idp\/|\/openam|\/nusso|\bnusso\b|\/xui\b|openathens|ezproxy|\/cas\/|\/adfs\/|duosecurity|\bduo\b|\/action\/showlogin|\/action\/dologin|accounts\.google\.com|login\.microsoftonline|\boauth\/authorize|auth0\.com|\bwebsso\b|\bwebauth\b)/i

// True when a URL is (or redirected to) an authentication wall, so the reader can route the
// user through an interactive sign-in rather than store a useless login page.
export function looksLikeLoginUrl(url) {
  try {
    return LOGIN_URL_PATTERN.test(new URL(url).href.toLowerCase())
  } catch {
    return false
  }
}

function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return null
  }
}

// Decide whether a captured response is actually a sign-in / paywall gate rather than the
// reading itself. Combines URL signals with content signals so JS-rendered SSO shells (which
// carry no login URL markers in their initial HTML) are still caught.
export function looksLikeGatedCapture({ target, destination, finalUrl, html, readableTextLength }) {
  if (looksLikeLoginUrl(finalUrl) || looksLikeLoginUrl(target)) return true

  const finalHost = hostOf(finalUrl)
  const targetHost = hostOf(target)
  const destHost = hostOf(destination)
  const lower = (html || "").toLowerCase()
  const hasPasswordField = /<input[^>]+type=["']?password["']?/i.test(html || "")
  const hasAuthWords = /(single sign-?on|online passport|log ?in|sign ?in|enter your password|netid)/i.test(lower)

  // Bounced to a third host that is neither the link nor its intended destination — classic
  // SSO/IdP redirect.
  const redirectedToThirdHost =
    Boolean(finalHost) && finalHost !== targetHost && finalHost !== destHost

  if (hasPasswordField) return true
  if (redirectedToThirdHost && hasAuthWords) return true
  // A tiny JS shell ("Loading…") with auth wording and almost no readable text.
  if ((readableTextLength ?? 0) < 250 && hasAuthWords) return true

  return false
}

// EZproxy / library-proxy links wrap the real article in a `?url=` (or `?qurl=`) parameter.
// Unwrap to the underlying reading so it can be matched and stored canonically.
export function unwrapProxyUrl(url) {
  try {
    const parsed = new URL(url)
    const inner = parsed.searchParams.get("url") || parsed.searchParams.get("qurl")
    if (inner) {
      const innerUrl = new URL(inner)
      if (innerUrl.protocol === "https:" || innerUrl.protocol === "http:") return innerUrl.toString()
    }
  } catch {
    // not a proxy url
  }
  return url
}

export function isLikelyCanvasTabUrl(url) {
  let parsed

  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  const hostname = parsed.hostname.toLowerCase()
  const pathname = parsed.pathname.toLowerCase()

  if (hostname.includes("instructure.com")) return true
  if (hostname.includes("canvas")) return true
  if (/^\/courses\/\d+(\/|$)/.test(pathname)) return true
  if (pathname.startsWith("/courses") && hostname.includes("edu")) return true

  return false
}

export function looksLikeActiveAssessment({ url, text = "", title = "" }) {
  const haystack = `${url}\n${title}\n${text.slice(0, 4000)}`.toLowerCase()

  if (/\/quizzes\/[^/]+\/take/.test(haystack)) return true
  if (haystack.includes("time limit") && haystack.includes("attempt")) return true
  if (haystack.includes("start quiz") || haystack.includes("take quiz")) return true
  if (haystack.includes("begin exam") || haystack.includes("start exam")) return true

  return false
}

export function classifyPageKind(url, title = "") {
  const pathname = new URL(url).pathname.toLowerCase()
  const text = title.toLowerCase()

  if (pathname.includes("/assignments")) return "assignment"
  if (pathname.includes("/modules")) return "module"
  if (pathname.includes("/assignments/syllabus") || pathname.includes("/syllabus")) return "syllabus"
  if (pathname.includes("/discussion_topics")) return "discussion"
  if (pathname.includes("/files")) return "file"
  if (pathname.includes("/pages")) return "page"
  if (pathname.includes("/calendar")) return "calendar"
  if (text.includes("dashboard")) return "dashboard"
  if (pathname.includes("/courses/")) return "course"

  return "canvas"
}

export function classifyCanvasNodeKind(url, title = "") {
  const pathname = new URL(url).pathname.toLowerCase()
  const text = title.toLowerCase()

  if (pathname.includes("/assignments")) return "assignment"
  if (pathname.includes("/modules")) return "module"
  if (pathname.includes("/discussion_topics")) return "discussion"
  if (pathname.includes("/files")) return "file"
  if (pathname.includes("/pages")) return "page"
  if (pathname.includes("/calendar")) return "calendar"
  if (/^\/courses\/\d+\/?$/.test(pathname)) return "course"
  if (text.includes("syllabus")) return "section"
  if (pathname.includes("/courses/")) return "section"

  return "unknown"
}
