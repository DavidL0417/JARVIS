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

  if (url.protocol === "http:" && isLocalhost(url.hostname)) {
    return url.origin
  }

  throw new Error("Use the production JARVIS URL or a localhost address.")
}

export function appHostPermissionPattern(appBaseUrl) {
  const url = new URL(normalizeJarvisAppBaseUrl(appBaseUrl))

  if (isLocalhost(url.hostname)) {
    return `${url.protocol}//${url.hostname}/*`
  }

  return `${url.protocol}//${url.hostname}/*`
}
