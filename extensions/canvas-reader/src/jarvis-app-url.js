const LOCAL_DEV_PORTS = new Set(["3000", "3001", "3002", "3003", "3004", "3005"])

function isLocalhost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1"
}

export function normalizeJarvisAppBaseUrl(value) {
  let url

  try {
    url = new URL(value)
  } catch {
    throw new Error("Enter a valid JARVIS app URL.")
  }

  if (url.protocol === "https:") {
    return url.origin
  }

  if (url.protocol === "http:" && isLocalhost(url.hostname) && LOCAL_DEV_PORTS.has(url.port)) {
    return url.origin
  }

  throw new Error("Use the production JARVIS URL or localhost ports 3000-3005.")
}

export function appHostPermissionPattern(appBaseUrl) {
  const url = new URL(normalizeJarvisAppBaseUrl(appBaseUrl))

  if (isLocalhost(url.hostname)) {
    return `${url.protocol}//${url.hostname}/*`
  }

  return `${url.protocol}//${url.hostname}/*`
}
