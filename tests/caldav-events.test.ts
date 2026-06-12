import { describe, expect, it } from "vitest"

import { parseCalDavEventsFromIcs, toCalDavScheduleEvent } from "@/lib/caldav/events"

const rangeStart = new Date("2026-05-01T00:00:00.000Z")
const rangeEnd = new Date("2026-05-31T23:59:59.000Z")

describe("CalDAV event parsing", () => {
  it("maps timed and all-day events from ICS", () => {
    const events = parseCalDavEventsFromIcs({
      rangeStart,
      rangeEnd,
      calendarData: `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:timed-1
SUMMARY:Office Hours
DTSTART:20260518T150000Z
DTEND:20260518T153000Z
LOCATION:Zoom
END:VEVENT
BEGIN:VEVENT
UID:all-day-1
SUMMARY:Conference
DTSTART;VALUE=DATE:20260520
DTEND;VALUE=DATE:20260522
END:VEVENT
END:VCALENDAR`,
    })

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      uid: "timed-1",
      title: "Office Hours",
      start: "2026-05-18T15:00:00.000Z",
      end: "2026-05-18T15:30:00.000Z",
      allDay: false,
      location: "Zoom",
    })
    expect(events[1]).toMatchObject({
      uid: "all-day-1",
      title: "Conference",
      start: "2026-05-20T00:00:00.000Z",
      end: "2026-05-21T23:59:00.000Z",
      allDay: true,
    })
  })

  it("anchors all-day events to local midnight when a timezone is supplied", () => {
    const events = parseCalDavEventsFromIcs({
      rangeStart,
      rangeEnd,
      timeZone: "America/Chicago",
      calendarData: `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:all-day-tz
SUMMARY:Conference
DTSTART;VALUE=DATE:20260520
DTEND;VALUE=DATE:20260522
END:VEVENT
END:VCALENDAR`,
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      uid: "all-day-tz",
      // Local CDT midnight is 05:00 UTC; exclusive end day minus one minute.
      start: "2026-05-20T05:00:00.000Z",
      end: "2026-05-22T04:59:00.000Z",
      allDay: true,
    })
  })

  it("skips cancelled events and expands recurrence instances in range", () => {
    const events = parseCalDavEventsFromIcs({
      rangeStart,
      rangeEnd,
      calendarData: `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:cancelled-1
STATUS:CANCELLED
SUMMARY:Cancelled
DTSTART:20260518T150000Z
DTEND:20260518T153000Z
END:VEVENT
BEGIN:VEVENT
UID:recurring-1
SUMMARY:Standup
DTSTART:20260518T140000Z
DTEND:20260518T141500Z
RRULE:FREQ=DAILY;COUNT=3
END:VEVENT
END:VCALENDAR`,
    })

    expect(events.map((event) => event.title)).toEqual(["Standup", "Standup", "Standup"])
    expect(events.map((event) => event.recurrenceKey)).toEqual([
      "20260518T140000Z",
      "20260519T140000Z",
      "20260520T140000Z",
    ])
  })

  it("creates read-only schedule events with CalDAV sync origin", () => {
    const event = toCalDavScheduleEvent({
      userId: "00000000-0000-4000-8000-000000000001",
      calendarId: "caldav-calendar:abc",
      externalEventId: "caldav:abc:def",
      parsedEvent: {
        uid: "timed-1",
        title: "Office Hours",
        start: "2026-05-18T15:00:00.000Z",
        end: "2026-05-18T15:30:00.000Z",
        allDay: false,
        location: null,
        recurrenceKey: null,
      },
    })

    expect(event).toMatchObject({
      source: "calendar",
      lastSyncedFrom: "caldav",
      isImmutable: true,
      isCheckedIn: true,
      externalEventId: "caldav:abc:def",
      gcalEventId: null,
    })
  })
})
