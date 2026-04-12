// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import type { ScheduleEvent, Task } from "@/types"

export type TaskScheduleActionLabel = "Initial Schedule" | "Reschedule"

export function hasScheduledTaskBlock(task: Pick<Task, "id" | "scheduledFor" | "status">, scheduleEvents: ScheduleEvent[]) {
  return (
    Boolean(task.scheduledFor) ||
    task.status === "scheduled" ||
    scheduleEvents.some((event) => event.taskId === task.id && event.source === "task")
  )
}

export function getTaskScheduleActionLabel(
  task: Pick<Task, "id" | "scheduledFor" | "status">,
  scheduleEvents: ScheduleEvent[],
): TaskScheduleActionLabel {
  return hasScheduledTaskBlock(task, scheduleEvents) ? "Reschedule" : "Initial Schedule"
}

// ##### END BACKEND #####
