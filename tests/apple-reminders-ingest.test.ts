import { describe, expect, it } from "vitest"

import {
  coerceRemindersPayload,
  mapReminderPriority,
  reminderExternalTaskId,
  reminderToTaskInsert,
} from "@/lib/apple-reminders/ingest"
import { TASKS_CALENDAR_ID } from "@/lib/task-calendar-constants"

describe("Apple Reminders ingest mapping", () => {
  it("maps a reminder to an immutable task-calendar insert", () => {
    const insert = reminderToTaskInsert("user-1", {
      title: "Buy batteries",
      notes: "AA, for the remote",
      dueDate: "2026-05-21T17:00:00Z",
      priority: "High",
      list: "Reminders",
    })

    expect(insert).toMatchObject({
      user_id: "user-1",
      title: "Buy batteries",
      description: "AA, for the remote",
      deadline: "2026-05-21T17:00:00.000Z",
      status: "todo",
      priority: "high",
      is_immutable: true,
      all_day: false,
      calendar_id: TASKS_CALENDAR_ID,
      tags: ["apple-reminders"],
      last_synced_from: "apple_reminders",
    })
    expect(insert.external_task_id).toMatch(/^apple-reminders:[0-9a-f]{32}$/)
  })

  it("handles undated reminders and empty notes", () => {
    const insert = reminderToTaskInsert("user-1", { title: "Do laundry", list: "Reminders" })
    expect(insert.deadline).toBeNull()
    expect(insert.description).toBeNull()
    expect(insert.priority).toBe("medium")
  })

  it("maps priority from both word and iCal-integer forms", () => {
    expect(mapReminderPriority("High")).toBe("high")
    expect(mapReminderPriority("low")).toBe("low")
    expect(mapReminderPriority("None")).toBe("medium")
    expect(mapReminderPriority(null)).toBe("medium")
    expect(mapReminderPriority(1)).toBe("high") // iCal 1 = highest
    expect(mapReminderPriority(5)).toBe("medium")
    expect(mapReminderPriority(9)).toBe("low")
    expect(mapReminderPriority(0)).toBe("medium") // 0 = undefined
  })

  it("derives a stable external id from list + title + due", () => {
    const base = { title: "Clean my room", dueDate: "2026-05-25T21:00:00Z", list: "Reminders" }
    // Same content (even with different notes/priority) → same id.
    expect(reminderExternalTaskId({ ...base, notes: "x", priority: "high" })).toBe(
      reminderExternalTaskId({ ...base, notes: "y", priority: "low" }),
    )
    // Different list, title, or due → different id.
    expect(reminderExternalTaskId(base)).not.toBe(reminderExternalTaskId({ ...base, list: "To do" }))
    expect(reminderExternalTaskId(base)).not.toBe(reminderExternalTaskId({ ...base, title: "Clean kitchen" }))
    expect(reminderExternalTaskId(base)).not.toBe(reminderExternalTaskId({ ...base, dueDate: "2026-05-26T21:00:00Z" }))
  })

  it("treats an invalid due date as undated rather than throwing", () => {
    const insert = reminderToTaskInsert("user-1", { title: "Someday", dueDate: "not a date" })
    expect(insert.deadline).toBeNull()
  })

  it("parses Apple Shortcuts' 'Month D, YYYY at H:MM AM/PM' date format", () => {
    const insert = reminderToTaskInsert("user-1", { title: "x", dueDate: "June 16, 2026 at 12:00 PM" })
    expect(insert.deadline).not.toBeNull()
    expect(new Date(insert.deadline as string).getUTCFullYear()).toBe(2026)
  })

  it("anchors a naive Shortcut due time to the user's timezone", () => {
    // "5:00 PM" in America/Chicago (CDT = UTC-5 in May) is 22:00 UTC — not 17:00.
    const insert = reminderToTaskInsert("user-1", { title: "x", dueDate: "May 21, 2026 at 5:00 PM" }, "America/Chicago")
    expect(insert.deadline).toBe("2026-05-21T22:00:00.000Z")
  })
})

describe("coerceRemindersPayload — Shortcuts body shape tolerance", () => {
  const items = [{ title: "a" }, { title: "b" }]

  it("passes through the canonical { reminders: [...] }", () => {
    expect(coerceRemindersPayload({ reminders: items })).toEqual({ reminders: items })
  })

  it("wraps a bare top-level array", () => {
    expect(coerceRemindersPayload(items)).toEqual({ reminders: items })
  })

  it("parses a stringified reminders array", () => {
    expect(coerceRemindersPayload({ reminders: JSON.stringify(items) })).toEqual({ reminders: items })
  })

  it("parses an array of stringified item objects", () => {
    expect(coerceRemindersPayload({ reminders: items.map((i) => JSON.stringify(i)) })).toEqual({ reminders: items })
  })

  it("parses a fully stringified body", () => {
    expect(coerceRemindersPayload(JSON.stringify({ reminders: items }))).toEqual({ reminders: items })
  })

  it("parses Apple Shortcuts' real shape: reminders as newline-delimited JSON objects", () => {
    // Exact shape captured from a live Shortcut run: a Text body field holding a
    // list of dictionaries becomes a string of NDJSON under "reminders".
    const body = {
      reminders:
        '{"title":"Buy batteries","notes":"","priority":"None","list":"Reminders","dueDate":"May 21, 2026 at 5:00 PM"}\n' +
        '{"title":"Do laundry","notes":"","priority":"None","list":"Reminders","dueDate":""}',
    }
    expect(coerceRemindersPayload(body)).toEqual({
      reminders: [
        { title: "Buy batteries", notes: "", priority: "None", list: "Reminders", dueDate: "May 21, 2026 at 5:00 PM" },
        { title: "Do laundry", notes: "", priority: "None", list: "Reminders", dueDate: "" },
      ],
    })
  })

  it("parses a single reminder sent as one JSON object string", () => {
    expect(coerceRemindersPayload({ reminders: '{"title":"Solo"}' })).toEqual({ reminders: [{ title: "Solo" }] })
  })

  it("returns an empty list for garbage rather than throwing", () => {
    expect(coerceRemindersPayload("not json")).toEqual({ reminders: [] })
    expect(coerceRemindersPayload(null)).toEqual({ reminders: [] })
    expect(coerceRemindersPayload({ reminders: 42 })).toEqual({ reminders: [] })
  })
})
