// Timezone-aware display helpers. Render instants in an explicit timezone rather
// than relying on the host's local timezone, so a user who sets a non-device
// timezone sees days and times bucketed correctly.

export function resolveDeviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

/** YYYY-MM-DD for `date` as seen in `timeZone` (the local calendar day). */
export function dayKey(date: Date | string, timeZone: string): string {
  const value = typeof date === "string" ? new Date(date) : date
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value)
  const year = parts.find((part) => part.type === "year")?.value ?? "0000"
  const month = parts.find((part) => part.type === "month")?.value ?? "01"
  const day = parts.find((part) => part.type === "day")?.value ?? "01"
  return `${year}-${month}-${day}`
}

export function formatTime(date: Date | string, timeZone: string): string {
  const value = typeof date === "string" ? new Date(date) : date
  return new Intl.DateTimeFormat([], {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(value)
}

export function formatDay(
  date: Date | string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" },
): string {
  const value = typeof date === "string" ? new Date(date) : date
  return new Intl.DateTimeFormat([], { timeZone, ...options }).format(value)
}
