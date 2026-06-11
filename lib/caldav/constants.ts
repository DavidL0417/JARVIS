export const APPLE_CALDAV_SERVER_URL = "https://caldav.icloud.com"

export function isAppleCalDavServerUrl(value: string | null | undefined) {
  if (!value) return false

  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.hostname === "caldav.icloud.com"
  } catch {
    return false
  }
}

export function getCalDavServerDisplayName(value: string | null | undefined) {
  if (isAppleCalDavServerUrl(value)) {
    return "Apple Calendar"
  }

  if (!value) return null

  try {
    return new URL(value).host
  } catch {
    return value
  }
}
