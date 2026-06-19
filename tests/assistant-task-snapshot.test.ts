import { describe, expect, it } from "vitest"

import { selectAssistantTasks } from "@/lib/assistant/dialogue"
import type { Task } from "@/types"

const NOW = new Date("2026-06-13T12:00:00Z").getTime()
const DAY = 24 * 60 * 60 * 1000

// Input order mirrors the assistant context: oldest-first (created_at ascending),
// so later array entries are more recently added.
function makeTask(overrides: Partial<Task> & { title: string }): Task {
  return {
    id: overrides.title,
    userId: "user-1",
    description: null,
    deadline: null,
    durationMinutes: null,
    priority: "medium",
    status: "todo",
    scheduledFor: null,
    isImmutable: false,
    allDay: false,
    calendarId: "cal-tasks",
    tags: [],
    course: null,
    category: null,
    sourceSnapshotId: null,
    sourceCandidateId: null,
    planId: null,
    externalTaskId: null,
    lastSyncedFrom: "local",
    inferredDeadline: null,
    inferredDeadlineReason: null,
    inferredDeadlineDismissed: false,
    ...overrides,
  }
}

describe("selectAssistantTasks", () => {
  it("surfaces a freshly-added task even behind many older ones (the old slice-8 bug)", () => {
    const older = Array.from({ length: 40 }, (_, i) => makeTask({ title: `old-${i}` }))
    const fresh = makeTask({ title: "Do laundry", lastSyncedFrom: "apple_reminders" })
    const result = selectAssistantTasks([...older, fresh], NOW)
    expect(result.some((task) => task.title === "Do laundry")).toBe(true)
    expect(result[0].title).toBe("Do laundry")
  })

  it("includes a task due within the next week even if it was added long ago", () => {
    const dueSoon = makeTask({ title: "Pay rent", deadline: new Date(NOW + 3 * DAY).toISOString() })
    const newerFiller = Array.from({ length: 40 }, (_, i) => makeTask({ title: `fill-${i}` }))
    const result = selectAssistantTasks([dueSoon, ...newerFiller], NOW)
    expect(result.some((task) => task.title === "Pay rent")).toBe(true)
  })

  it("labels each task's source", () => {
    const result = selectAssistantTasks(
      [
        makeTask({ title: "r", lastSyncedFrom: "apple_reminders" }),
        makeTask({ title: "c", lastSyncedFrom: "caldav" }),
        makeTask({ title: "j", lastSyncedFrom: "local" }),
      ],
      NOW,
    )
    expect(result.find((task) => task.title === "r")?.source).toBe("Apple Reminders")
    expect(result.find((task) => task.title === "c")?.source).toBe("Apple Calendar")
    expect(result.find((task) => task.title === "j")?.source).toBe("JARVIS")
  })

  it("excludes completed and missed tasks", () => {
    const result = selectAssistantTasks(
      [
        makeTask({ title: "done", status: "completed" }),
        makeTask({ title: "gone", status: "missed" }),
        makeTask({ title: "active" }),
      ],
      NOW,
    )
    expect(result.map((task) => task.title)).toEqual(["active"])
  })

  it("caps the snapshot at 30 tasks", () => {
    const many = Array.from({ length: 80 }, (_, i) => makeTask({ title: `t-${i}` }))
    expect(selectAssistantTasks(many, NOW)).toHaveLength(30)
  })
})
