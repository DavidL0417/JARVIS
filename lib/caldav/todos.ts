import ICAL from "ical.js"

import { zonedDateStartUtc } from "@/lib/time/zoned"
import { TASKS_CALENDAR_ID } from "@/lib/task-calendar-constants"
import type { Priority, TaskInsertRow } from "@/types"

const REMINDER_TAG = "apple-reminders"

export interface CalDavParsedTodo {
  uid: string
  title: string
  description: string | null
  deadline: string | null
  allDay: boolean
  priority: Priority
}

function normalizeText(value: unknown, fallback: string) {
  const trimmed = typeof value === "string" ? value.trim() : ""
  return trimmed.length > 0 ? trimmed : fallback
}

function pad2(value: number) {
  return String(value).padStart(2, "0")
}

// A VTODO DUE can be a DATE (all-day) or a DATE-TIME. Mirror the VEVENT handling:
// anchor all-day dates to local midnight in the user's timezone when known.
function dueToIso(time: ICAL.Time, timeZone: string | null): { iso: string; allDay: boolean } {
  if (time.isDate) {
    const baseMs = timeZone
      ? zonedDateStartUtc(`${time.year}-${pad2(time.month)}-${pad2(time.day)}`, timeZone).getTime()
      : Date.UTC(time.year, time.month - 1, time.day)
    return { iso: new Date(baseMs).toISOString(), allDay: true }
  }

  return { iso: new Date(time.toJSDate().getTime()).toISOString(), allDay: false }
}

// iCalendar PRIORITY is 1 (highest) .. 9 (lowest); 0/absent means undefined.
// Apple Reminders emit 1 (High), 5 (Medium), 9 (Low).
function mapTodoPriority(value: unknown): Priority {
  const numeric = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "medium"
  }
  if (numeric <= 4) {
    return "high"
  }
  if (numeric >= 6) {
    return "low"
  }
  return "medium"
}

export function parseCalDavTodosFromIcs(input: {
  calendarData: string
  timeZone?: string | null
}): CalDavParsedTodo[] {
  if (!input.calendarData.trim()) {
    return []
  }

  const timeZone = input.timeZone ?? null
  const component = new ICAL.Component(ICAL.parse(input.calendarData))
  const todoComponents = component.getAllSubcomponents("vtodo")
  const todos: CalDavParsedTodo[] = []

  for (const todoComponent of todoComponents) {
    // One-way ingest mirrors *open* reminders only. Completed/cancelled todos are
    // skipped so that checking one off (or deleting it) on the phone removes its
    // mirrored task on the next sync via reconciliation.
    const status = normalizeText(todoComponent.getFirstPropertyValue("status"), "").toUpperCase()
    if (status === "COMPLETED" || status === "CANCELLED") {
      continue
    }
    if (todoComponent.getFirstPropertyValue("completed")) {
      continue
    }

    const uid = normalizeText(todoComponent.getFirstPropertyValue("uid"), "")
    if (!uid) {
      // Without a stable UID we can't dedupe across syncs; skip rather than mint dupes.
      continue
    }

    const due = todoComponent.getFirstPropertyValue("due") as ICAL.Time | null
    const mappedDue = due ? dueToIso(due, timeZone) : null

    todos.push({
      uid,
      title: normalizeText(todoComponent.getFirstPropertyValue("summary"), "Untitled reminder"),
      description: normalizeText(todoComponent.getFirstPropertyValue("description"), "") || null,
      deadline: mappedDue?.iso ?? null,
      allDay: mappedDue?.allDay ?? false,
      priority: mapTodoPriority(todoComponent.getFirstPropertyValue("priority")),
    })
  }

  return todos
}

export function toCalDavTaskInsert(input: {
  parsedTodo: CalDavParsedTodo
  userId: string
  externalTaskId: string
}): TaskInsertRow {
  return {
    user_id: input.userId,
    title: input.parsedTodo.title,
    description: input.parsedTodo.description,
    deadline: input.parsedTodo.deadline,
    duration_minutes: null,
    priority: input.parsedTodo.priority,
    status: "todo",
    scheduled_for: null,
    // One-way mirror: keep reminders read-only in Jarvis so local edits never
    // fight the next sync. Edits happen on the phone.
    is_immutable: true,
    all_day: input.parsedTodo.allDay,
    calendar_id: TASKS_CALENDAR_ID,
    tags: [REMINDER_TAG],
    external_task_id: input.externalTaskId,
    last_synced_from: "caldav",
  }
}
