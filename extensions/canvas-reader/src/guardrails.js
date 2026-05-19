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
