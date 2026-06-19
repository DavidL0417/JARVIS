import type { Task } from "@/types"

// Tags that carry no signal in a task row: the kind tags ("task"/"deadline"/
// "event") duplicate the status the row already shows, "source-review" is a
// retired provisional marker, and the source markers ("canvas", "apple-reminders",
// …) duplicate `lastSyncedFrom` (shown as the row's source glyph / section).
// Hidden from display, never stripped from the data.
export const NOISE_TAGS = new Set([
  "source-review",
  "task",
  "deadline",
  "event",
  "canvas",
  "notion",
  "gmail",
  "apple-reminders",
  "apple_reminders",
  "caldav",
])

// "MATH 240 — Linear Algebra" → "MATH 240" for a compact course chip (the code
// before the em/en dash). The full label stays available for tooltips/filtering.
// Plain hyphens are preserved so "SOCIOL 310-0 — …" keeps its section number.
export function shortCourseLabel(course: string | null | undefined): string | null {
  if (!course) {
    return null
  }
  const head = course.split(/\s*[—–]\s*/)[0]?.trim()
  return head && head.length > 0 ? head : course
}

// Overdue = a live task with a deadline in the past. Completed and missed tasks
// are never overdue (missed work ages out to the "Needs you" Archive instead).
export function isTaskOverdue(task: Task, nowMs: number): boolean {
  if (task.status === "completed" || task.status === "missed" || !task.deadline) {
    return false
  }

  return new Date(task.deadline).getTime() < nowMs
}

// Short, locale-aware deadline label (e.g. "Jun 18, 3:00 PM"). Null when there is
// no deadline or the stored value can't be parsed.
export function formatDeadlineShort(value: string | null): string | null {
  if (!value) {
    return null
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

// Deadline ordering shared by every task list: soonest first, undated last.
// Returns 0 when both sides sort equally (including two undated tasks) so callers
// can fall through to their own tie-breakers.
export function compareByDeadline(left: Task, right: Task): number {
  const leftMs = left.deadline ? new Date(left.deadline).getTime() : Number.POSITIVE_INFINITY
  const rightMs = right.deadline ? new Date(right.deadline).getTime() : Number.POSITIVE_INFINITY

  if (leftMs === rightMs) {
    return 0
  }

  return leftMs - rightMs
}

// Canonical display orders, shared by the pane's grouping and the filter/sort
// engine (so a Status select and the Status group agree on ordering).
export const TASK_STATUS_ORDER = ["Overdue", "Todo", "Scheduled", "Completed", "Missed"]
export const TASK_SOURCE_ORDER = ["Notion", "Canvas", "Gmail", "Apple Reminders", "Apple Calendar", "JARVIS"]
export const TASK_PRIORITY_ORDER = ["High", "Medium", "Low"]

// The source channel a task flowed in from. Prefers the structured provenance
// (`lastSyncedFrom`); falls back to a legacy "canvas" tag; else JARVIS-native.
export function taskSourceLabel(task: Task): string {
  if (task.lastSyncedFrom === "notion") return "Notion"
  if (task.lastSyncedFrom === "gmail") return "Gmail"
  if (task.lastSyncedFrom === "canvas") return "Canvas"
  if (task.lastSyncedFrom === "apple_reminders") return "Apple Reminders"
  if (task.lastSyncedFrom === "caldav") return "Apple Calendar"
  if (task.tags.includes("canvas")) return "Canvas"
  return "JARVIS"
}

// The human status label (Overdue is derived from a live past deadline, not a
// stored status). Shared by the Status group, the Status filter, and Status sort.
export function taskStatusLabel(task: Task, nowMs: number): string {
  if (task.status === "completed") return "Completed"
  if (task.status === "missed") return "Missed"
  if (isTaskOverdue(task, nowMs)) return "Overdue"
  if (task.status === "scheduled" || task.scheduledFor) return "Scheduled"
  return "Todo"
}

// "high" → "High". Priority is stored lowercase; chips/filters show title case.
export function priorityLabel(priority: string): string {
  return priority ? priority[0].toUpperCase() + priority.slice(1) : priority
}
