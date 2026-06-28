import { addDaysToDateKey, localDateKeyFromIso } from "@/lib/time/date-keys"

// Minimal RFC 5545 VEVENT serializer for events JARVIS writes to CalDAV. tsdav's
// createCalendarObject takes a plain iCalendar string; we hand-build one rather than
// pull a dependency. Timed events are emitted in UTC ("Z"), so no VTIMEZONE block is
// needed; all-day events use VALUE=DATE with an EXCLUSIVE end (Google/Apple all-day
// end.date is the day AFTER the last day).

export interface BuildEventIcsInput {
  uid: string
  title: string
  startIso: string
  endIso: string
  allDay: boolean
  timeZone: string
  location?: string | null
  description?: string | null
  // Overridable for deterministic tests; defaults to now.
  dtStampIso?: string
}

// RFC 5545 TEXT escaping: backslash first, then ; , and newlines.
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n")
}

// "2026-06-28T01:00:00.000Z" -> "20260628T010000Z"
function utcCompact(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}

// "2026-06-28" -> "20260628"
function compactDate(dateKey: string): string {
  return dateKey.replace(/-/g, "")
}

// Fold content lines to <=75 octets with CRLF + space continuations, never splitting
// a multi-byte UTF-8 sequence.
function foldLine(line: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) {
    return line
  }
  const chunks: string[] = []
  let current = ""
  let currentBytes = 0
  let isFirst = true
  for (const ch of line) {
    const chBytes = encoder.encode(ch).length
    // Continuation lines carry a leading space that counts toward the 75 octets.
    const limit = isFirst ? 75 : 74
    if (currentBytes + chBytes > limit) {
      chunks.push(current)
      current = ch
      currentBytes = chBytes
      isFirst = false
    } else {
      current += ch
      currentBytes += chBytes
    }
  }
  chunks.push(current)
  return chunks.join("\r\n ")
}

export function buildEventIcs(input: BuildEventIcsInput): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JARVIS//secretaryjarvis.com//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${utcCompact(input.dtStampIso ?? new Date().toISOString())}`,
    `SUMMARY:${escapeText(input.title)}`,
    "SEQUENCE:0",
  ]

  if (input.allDay) {
    const startDateKey = localDateKeyFromIso(input.startIso, input.timeZone)
    let lastDayKey = localDateKeyFromIso(input.endIso, input.timeZone)
    if (lastDayKey < startDateKey) {
      lastDayKey = startDateKey
    }
    lines.push(`DTSTART;VALUE=DATE:${compactDate(startDateKey)}`)
    // Exclusive end: the day AFTER the last day of the event.
    lines.push(`DTEND;VALUE=DATE:${compactDate(addDaysToDateKey(lastDayKey, 1))}`)
  } else {
    lines.push(`DTSTART:${utcCompact(input.startIso)}`)
    lines.push(`DTEND:${utcCompact(input.endIso)}`)
  }

  if (input.location?.trim()) {
    lines.push(`LOCATION:${escapeText(input.location.trim())}`)
  }
  if (input.description?.trim()) {
    lines.push(`DESCRIPTION:${escapeText(input.description.trim())}`)
  }

  lines.push("END:VEVENT", "END:VCALENDAR")

  return lines.map(foldLine).join("\r\n") + "\r\n"
}

// Provenance-tagged UID; the "jarvis-" prefix marks events JARVIS authored.
export function generateEventUid(): string {
  return `jarvis-${crypto.randomUUID()}@secretaryjarvis.com`
}

export function icsFilename(uid: string): string {
  return `${uid}.ics`
}
