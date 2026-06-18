import type { Task } from "@/types"

// Tags that carry no signal in a task row: the kind tags ("task"/"deadline"/
// "event") duplicate the status the row already shows, and "source-review" is a
// retired provisional marker. Hidden from display, never stripped from the data.
export const NOISE_TAGS = new Set(["source-review", "task", "deadline", "event"])

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
