import { describe, expect, it } from "vitest"

import { classifyGoogleCalendarTaskChangeForTest } from "../lib/sources/calendar-feedback"
import type { ScheduleEvent } from "../types"

function makeEvent(overrides: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    userId: "00000000-0000-4000-8000-000000000001",
    taskId: "00000000-0000-4000-8000-000000000002",
    title: "Study block",
    start: "2026-05-14T15:00:00.000Z",
    end: "2026-05-14T16:00:00.000Z",
    source: "task",
    priority: "medium",
    status: "scheduled",
    location: null,
    externalEventId: "primary:event-1",
    gcalEventId: "primary:event-1",
    lastSyncedFrom: "local",
    isImmutable: false,
    isCheckedIn: false,
    allDay: false,
    calendarId: "cal-tasks",
    planId: null,
    ...overrides,
  }
}

describe("Google Calendar task feedback", () => {
  it("detects deleted, moved, and duration-changed task blocks", () => {
    expect(classifyGoogleCalendarTaskChangeForTest(makeEvent(), null)).toMatchObject({
      type: "deleted",
    })

    expect(
      classifyGoogleCalendarTaskChangeForTest(
        makeEvent(),
        makeEvent({
          start: "2026-05-14T17:00:00.000Z",
          end: "2026-05-14T18:00:00.000Z",
        }),
      ),
    ).toMatchObject({
      type: "moved",
    })

    expect(
      classifyGoogleCalendarTaskChangeForTest(
        makeEvent(),
        makeEvent({
          end: "2026-05-14T16:30:00.000Z",
        }),
      ),
    ).toMatchObject({
      type: "duration_changed",
    })
  })
})
