import { describe, expect, it } from "vitest"

import { mapGoogleEventToScheduleEventForTest } from "../lib/google-calendar-events"
import { dayKey, formatTime } from "../lib/time/format"
import { zonedDateStartUtc, zonedDateTimeToUtc } from "../lib/time/zoned"

describe("timezone display helpers", () => {
  it("buckets an instant onto the correct local day per timezone", () => {
    // 03:00 UTC is still the previous evening in Chicago but already that day in London.
    const instant = "2026-05-20T03:00:00.000Z"
    expect(dayKey(instant, "America/Chicago")).toBe("2026-05-19")
    expect(dayKey(instant, "Europe/London")).toBe("2026-05-20")
    expect(dayKey(instant, "UTC")).toBe("2026-05-20")
  })

  it("formats a time in the requested timezone", () => {
    const instant = "2026-05-20T14:00:00.000Z"
    // 14:00 UTC = 09:00 CDT.
    expect(formatTime(instant, "America/Chicago")).toMatch(/9[:.]00/)
  })
})

describe("zoned date helpers", () => {
  it("resolves a calendar date to midnight in the user's timezone", () => {
    // Chicago is UTC-5 in May (CDT) → local midnight is 05:00 UTC.
    expect(zonedDateStartUtc("2026-05-20", "America/Chicago").toISOString()).toBe("2026-05-20T05:00:00.000Z")
    // London is UTC+1 in May (BST) → local midnight is 23:00 UTC the prior day.
    expect(zonedDateStartUtc("2026-05-20", "Europe/London").toISOString()).toBe("2026-05-19T23:00:00.000Z")
    // UTC is the identity case.
    expect(zonedDateStartUtc("2026-05-20", "UTC").toISOString()).toBe("2026-05-20T00:00:00.000Z")
  })

  it("converts a zoned wall-clock time to the correct UTC instant", () => {
    expect(zonedDateTimeToUtc("2026-05-20", "09:00", "America/Chicago").toISOString()).toBe(
      "2026-05-20T14:00:00.000Z",
    )
  })
})

describe("Google all-day event mapping is timezone-aware", () => {
  const userId = "00000000-0000-4000-8000-000000000001"

  it("places an all-day event on the user's local day, not server-UTC midnight", () => {
    const event = mapGoogleEventToScheduleEventForTest(
      {
        id: "all-day-1",
        summary: "Conference",
        start: { date: "2026-05-20" },
        end: { date: "2026-05-22" },
      },
      "class-calendar",
      userId,
      "America/Chicago",
    )

    expect(event).not.toBeNull()
    expect(event?.allDay).toBe(true)
    // Start = local midnight (CDT) of the first day.
    expect(event?.start).toBe("2026-05-20T05:00:00.000Z")
    // End = one minute before local midnight of Google's exclusive end day (05-22),
    // i.e. it stays within 05-21 in Chicago.
    expect(event?.end).toBe("2026-05-22T04:59:00.000Z")
  })

  it("still maps timed events from their dateTime with offset", () => {
    const event = mapGoogleEventToScheduleEventForTest(
      {
        id: "timed-1",
        summary: "Office Hours",
        start: { dateTime: "2026-05-18T15:00:00-05:00" },
        end: { dateTime: "2026-05-18T15:30:00-05:00" },
      },
      "class-calendar",
      userId,
      "America/Chicago",
    )

    expect(event?.allDay).toBe(false)
    expect(event?.start).toBe("2026-05-18T20:00:00.000Z")
    expect(event?.end).toBe("2026-05-18T20:30:00.000Z")
  })
})
