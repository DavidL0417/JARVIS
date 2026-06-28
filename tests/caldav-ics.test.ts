import { describe, expect, it } from "vitest"

import { buildEventIcs, generateEventUid, icsFilename } from "../lib/caldav/ics"

const base = {
  uid: "jarvis-test@secretaryjarvis.com",
  title: "Dinner",
  timeZone: "America/Chicago",
  dtStampIso: "2026-06-27T00:00:00.000Z",
}

describe("buildEventIcs", () => {
  it("serializes a timed event in UTC with CRLF lines", () => {
    const ics = buildEventIcs({
      ...base,
      startIso: "2026-06-28T01:00:00.000Z",
      endIso: "2026-06-28T02:00:00.000Z",
      allDay: false,
    })
    expect(ics).toContain("BEGIN:VCALENDAR")
    expect(ics).toContain("BEGIN:VEVENT")
    expect(ics).toContain("UID:jarvis-test@secretaryjarvis.com")
    expect(ics).toContain("DTSTAMP:20260627T000000Z")
    expect(ics).toContain("DTSTART:20260628T010000Z")
    expect(ics).toContain("DTEND:20260628T020000Z")
    expect(ics).toContain("SUMMARY:Dinner")
    expect(ics).toContain("END:VCALENDAR")
    // CRLF line endings, trailing CRLF.
    expect(ics.includes("\r\n")).toBe(true)
    expect(ics.endsWith("\r\n")).toBe(true)
  })

  it("anchors all-day dates to local tz with an EXCLUSIVE end (no off-by-one)", () => {
    // 01:00Z is the evening BEFORE in America/Chicago — local date 2026-06-27.
    const ics = buildEventIcs({
      ...base,
      title: "Conference",
      startIso: "2026-06-28T01:00:00.000Z",
      endIso: "2026-06-28T01:00:00.000Z",
      allDay: true,
    })
    expect(ics).toContain("DTSTART;VALUE=DATE:20260627")
    // exclusive end = last day + 1
    expect(ics).toContain("DTEND;VALUE=DATE:20260628")
    expect(ics).not.toContain("DTSTART:2026") // not a timed DTSTART
  })

  it("escapes RFC 5545 TEXT special characters", () => {
    const ics = buildEventIcs({
      ...base,
      title: "a, b; c\nd",
      startIso: "2026-06-28T01:00:00.000Z",
      endIso: "2026-06-28T02:00:00.000Z",
      allDay: false,
    })
    expect(ics).toContain("SUMMARY:a\\, b\\; c\\nd")
  })

  it("folds content lines longer than 75 octets", () => {
    const ics = buildEventIcs({
      ...base,
      startIso: "2026-06-28T01:00:00.000Z",
      endIso: "2026-06-28T02:00:00.000Z",
      allDay: false,
      description: "x".repeat(200),
    })
    // A folded line continues with CRLF + a single leading space.
    expect(ics).toMatch(/DESCRIPTION:x+\r\n x/)
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    }
  })

  it("folds multi-byte (emoji/CJK) content without splitting a UTF-8 sequence", () => {
    // No spaces — keeps the assertion off fold-boundary whitespace ambiguity.
    const title = "🎉".repeat(30) + "会議の予定".repeat(10)
    const ics = buildEventIcs({
      ...base,
      title,
      startIso: "2026-06-28T01:00:00.000Z",
      endIso: "2026-06-28T02:00:00.000Z",
      allDay: false,
    })
    const encoder = new TextEncoder()
    for (const line of ics.split("\r\n")) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75)
    }
    // Unfolding (strip CRLF+space continuations) reconstructs the SUMMARY exactly —
    // proves no UTF-8 sequence was split (a botched split yields � replacement chars).
    const unfolded = ics.replace(/\r\n /g, "")
    expect(unfolded).toContain(`SUMMARY:${title}`)
    expect(ics).not.toContain("�")
  })

  it("generates a provenance-tagged UID and .ics filename", () => {
    const uid = generateEventUid()
    expect(uid.startsWith("jarvis-")).toBe(true)
    expect(uid.endsWith("@secretaryjarvis.com")).toBe(true)
    expect(icsFilename(uid)).toBe(`${uid}.ics`)
  })
})
