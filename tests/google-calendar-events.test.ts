import { describe, expect, it } from "vitest"

import { getStaleGoogleMirrorEventIdsForTest } from "../lib/google-calendar-events"

const syncWindow = {
  timeMin: "2026-05-01T00:00:00.000Z",
  timeMax: "2026-05-31T23:59:59.000Z",
}

function makeMirroredEvent(overrides: Partial<Parameters<typeof getStaleGoogleMirrorEventIdsForTest>[0]["mirroredEvents"][number]> = {}) {
  return {
    id: "event-1",
    gcal_event_id: "class-calendar:google-event-1",
    calendar_id: "google-calendar:class-calendar",
    starts_at: "2026-05-18T20:00:00.000Z",
    ends_at: "2026-05-18T21:00:00.000Z",
    source: "calendar" as const,
    last_synced_from: "gcal" as const,
    ...overrides,
  }
}

describe("Google Calendar mirror reconciliation", () => {
  it("removes imported Google events that disappeared from the current provider window", () => {
    expect(
      getStaleGoogleMirrorEventIdsForTest({
        mirroredEvents: [makeMirroredEvent()],
        currentGcalEventIds: new Set(),
        currentCalendarKeys: new Set(["google-calendar:class-calendar"]),
        syncWindow,
      }),
    ).toEqual(["event-1"])
  })

  it("keeps current events and events outside the reconciled time window", () => {
    expect(
      getStaleGoogleMirrorEventIdsForTest({
        mirroredEvents: [
          makeMirroredEvent({ id: "current-event" }),
          makeMirroredEvent({
            id: "old-event",
            gcal_event_id: "class-calendar:old-event",
            starts_at: "2026-01-18T20:00:00.000Z",
            ends_at: "2026-01-18T21:00:00.000Z",
          }),
        ],
        currentGcalEventIds: new Set(["class-calendar:google-event-1"]),
        currentCalendarKeys: new Set(["google-calendar:class-calendar"]),
        syncWindow,
      }),
    ).toEqual([])
  })

  it("removes imported events from Google calendars no longer returned by the provider", () => {
    expect(
      getStaleGoogleMirrorEventIdsForTest({
        mirroredEvents: [makeMirroredEvent()],
        currentGcalEventIds: new Set(["class-calendar:google-event-1"]),
        currentCalendarKeys: new Set(["google-calendar:remaining-calendar"]),
        syncWindow,
      }),
    ).toEqual(["event-1"])
  })

  it("does not delete mirrored JARVIS task events from Google read reconciliation", () => {
    expect(
      getStaleGoogleMirrorEventIdsForTest({
        mirroredEvents: [
          makeMirroredEvent({
            id: "task-block",
            source: "task",
            calendar_id: "cal-tasks",
          }),
        ],
        currentGcalEventIds: new Set(),
        currentCalendarKeys: new Set(["google-calendar:class-calendar"]),
        syncWindow,
      }),
    ).toEqual([])
  })
})
