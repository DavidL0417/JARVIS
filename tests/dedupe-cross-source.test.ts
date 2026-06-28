import { describe, expect, it } from "vitest"

import { dedupeCrossSourceEvents } from "../lib/dedupe-cross-source"
import type { ScheduleEvent, SyncOrigin } from "../types"

let counter = 0
function ev(over: Partial<ScheduleEvent> & { lastSyncedFrom: SyncOrigin }): ScheduleEvent {
  counter += 1
  return {
    id: `e${counter}`,
    userId: "u1",
    taskId: null,
    title: "Event",
    start: "2026-06-28T20:00:00.000Z",
    end: "2026-06-28T21:00:00.000Z",
    source: "calendar",
    priority: "medium",
    status: null,
    location: null,
    externalEventId: null,
    gcalEventId: null,
    icalUid: null,
    isImmutable: true,
    isCheckedIn: true,
    allDay: false,
    calendarId: null,
    planId: null,
    ...over,
  }
}

const ids = (events: ScheduleEvent[]) => events.map((e) => e.id).sort()

describe("dedupeCrossSourceEvents", () => {
  it("is a no-op when only one source is present", () => {
    const events = [ev({ lastSyncedFrom: "gcal" }), ev({ lastSyncedFrom: "gcal" })]
    expect(dedupeCrossSourceEvents(events)).toHaveLength(2)
  })

  it("Tier 1: collapses same UID + start across sources, keeping the gcal copy", () => {
    const g = ev({ id: "g", lastSyncedFrom: "gcal", icalUid: "ABC-123" })
    const c = ev({ id: "c", lastSyncedFrom: "caldav", icalUid: "abc-123" }) // case-insensitive
    const result = dedupeCrossSourceEvents([g, c])
    expect(ids(result)).toEqual(["g"])
  })

  it("Tier 1: keeps recurring occurrences (same UID, different starts)", () => {
    const g1 = ev({ id: "g1", lastSyncedFrom: "gcal", icalUid: "R", start: "2026-06-28T20:00:00.000Z", end: "2026-06-28T21:00:00.000Z" })
    const c1 = ev({ id: "c1", lastSyncedFrom: "caldav", icalUid: "R", start: "2026-06-28T20:00:00.000Z", end: "2026-06-28T21:00:00.000Z" })
    const c2 = ev({ id: "c2", lastSyncedFrom: "caldav", icalUid: "R", start: "2026-06-29T20:00:00.000Z", end: "2026-06-29T21:00:00.000Z" })
    const result = dedupeCrossSourceEvents([g1, c1, c2])
    // c1 collapses into g1; c2 (different occurrence) survives.
    expect(ids(result)).toEqual(["c2", "g1"])
  })

  it("Tier 2: collapses identical title+time across sources when UIDs differ/missing", () => {
    const g = ev({ id: "g", lastSyncedFrom: "gcal", icalUid: "google-rewritten@google.com", title: "Standup" })
    const c = ev({ id: "c", lastSyncedFrom: "caldav", icalUid: null, title: "Standup" })
    const result = dedupeCrossSourceEvents([g, c])
    expect(ids(result)).toEqual(["g"])
  })

  it("does not collapse two distinct same-time events within ONE source", () => {
    const g1 = ev({ id: "g1", lastSyncedFrom: "gcal", title: "Standup" })
    const g2 = ev({ id: "g2", lastSyncedFrom: "gcal", title: "Standup" })
    const c = ev({ id: "c", lastSyncedFrom: "caldav", title: "Different Meeting" })
    const result = dedupeCrossSourceEvents([g1, g2, c])
    // Both gcal copies survive (intra-source never collapsed); the caldav one has no match.
    expect(ids(result)).toEqual(["c", "g1", "g2"])
  })

  it("Tier 2: collapses an all-day event subscribed Apple→Google (UID rewritten)", () => {
    const allDay = { allDay: true, start: "2026-06-28T05:00:00.000Z", end: "2026-06-29T04:59:00.000Z" }
    const g = ev({ id: "g", lastSyncedFrom: "gcal", icalUid: "abc@google.com", title: "Holiday", ...allDay })
    const c = ev({ id: "c", lastSyncedFrom: "caldav", icalUid: "ORIGINAL-UID", title: "Holiday", ...allDay })
    const result = dedupeCrossSourceEvents([g, c])
    expect(ids(result)).toEqual(["g"])
  })

  it("does not suppress a CalDAV event with no cross-source match", () => {
    const g = ev({ id: "g", lastSyncedFrom: "gcal", title: "Lunch", start: "2026-06-28T17:00:00.000Z", end: "2026-06-28T18:00:00.000Z" })
    const c = ev({ id: "c", lastSyncedFrom: "caldav", title: "Dentist", start: "2026-06-28T20:00:00.000Z", end: "2026-06-28T21:00:00.000Z" })
    const result = dedupeCrossSourceEvents([g, c])
    expect(ids(result)).toEqual(["c", "g"])
  })
})
