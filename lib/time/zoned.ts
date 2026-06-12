// Shared timezone-aware date helpers.
//
// All-day calendar dates (Google `date`, CalDAV `VALUE=DATE`) are timezone-naive
// "floating" dates. To place them on the correct day for the user we resolve the
// calendar date to the UTC instant of midnight *in the user's timezone* — not the
// server's local timezone (which on Vercel is UTC and silently shifts the day).

export const DEFAULT_TIMEZONE = "America/Chicago"

function getOffsetMinutes(date: Date, timeZone: string): number {
  const offsetLabel =
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value || "GMT"

  if (offsetLabel === "GMT") {
    return 0
  }

  const match = offsetLabel.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/)

  if (!match) {
    throw new Error(`Unsupported timezone offset label "${offsetLabel}" for ${timeZone}.`)
  }

  const sign = match[1] === "-" ? -1 : 1
  const hours = Number(match[2])
  const minutes = Number(match[3] ?? "0")

  return sign * (hours * 60 + minutes)
}

/**
 * Resolve a wall-clock date + time in `timeZone` to the corresponding UTC instant.
 * Iterates to converge across DST boundaries.
 */
export function zonedDateTimeToUtc(dateKey: string, time: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number)
  const [hours, minutes] = time.split(":").map(Number)
  const localUtcGuess = Date.UTC(year, month - 1, day, hours, minutes, 0, 0)
  let currentMs = localUtcGuess

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offsetMinutes = getOffsetMinutes(new Date(currentMs), timeZone)
    const nextMs = localUtcGuess - offsetMinutes * 60_000

    if (nextMs === currentMs) {
      break
    }

    currentMs = nextMs
  }

  return new Date(currentMs)
}

/** UTC instant for midnight (00:00) of `dateKey` (YYYY-MM-DD) in `timeZone`. */
export function zonedDateStartUtc(dateKey: string, timeZone: string): Date {
  return zonedDateTimeToUtc(dateKey, "00:00", timeZone)
}
