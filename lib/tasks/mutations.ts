import type { SupabaseClient } from "@supabase/supabase-js"

import { mapTaskRowToTask, mapTaskToUpdate, TASK_SELECT } from "@/lib/data/mappers"
import { markCanvasTaskComplete, type CanvasExternalWriteResult } from "@/lib/sources/canvas-completion"
import { syncNotionTaskCompletion, syncNotionTaskFields } from "@/lib/sources/notion-completion"
import { TASKS_CALENDAR_ID } from "@/lib/task-calendar-constants"
import type { Priority, Task, TaskRow, TaskStatus } from "@/types"

// Shared task-mutation building blocks used by BOTH the tasks HTTP route and the
// assistant agent loop, so a task edit fires the exact same external write-backs
// (Canvas planner override on completion, Notion checkbox + field push) no matter
// which surface made it. Keeping this in one place is what lets the empowered
// agent "just edit the task" without re-implementing — or silently skipping — the
// downstream sync the dashboard route already does.

// The camelCase update shape (a subset of Task). Mirrors updateTaskRequestSchema
// in schemas/tasks.ts (which is backend-owned, so we don't re-derive its type
// from there) — keep the two in sync if either grows a field.
export interface TaskUpdateFields {
  title?: string
  description?: string | null
  deadline?: string | null
  durationMinutes?: number | null
  priority?: Priority
  status?: TaskStatus
  isImmutable?: boolean
  allDay?: boolean
  calendarId?: string | null
  tags?: string[]
  scheduledFor?: string | null
}

export type ApplyTaskUpdateResult =
  | { ok: true; task: Task; externalWrite: CanvasExternalWriteResult | null }
  | { ok: false; reason: "not_found" }

/**
 * Update a task's fields and run the same side effects as PATCH /api/tasks/[id]:
 * - status → completed|todo clears the task's own schedule blocks (they no longer
 *   reflect reality),
 * - status → completed pushes a Canvas planner-override completion,
 * - status → completed|todo flips the linked Notion checkbox (best-effort),
 * - title/deadline edits push to the linked Notion page (best-effort).
 *
 * Returns `not_found` when no row matches (caller decides 404 vs. a chat reply).
 */
export async function applyTaskUpdate(input: {
  adminClient: SupabaseClient
  userId: string
  taskId: string
  fields: TaskUpdateFields
}): Promise<ApplyTaskUpdateResult> {
  const { adminClient, userId, taskId, fields } = input

  const updatePayload = {
    ...mapTaskToUpdate(fields),
    updated_at: new Date().toISOString(),
  }

  if (fields.status === "completed" || fields.status === "todo") {
    const { error: deleteScheduleEventsError } = await adminClient
      .from("schedule_events")
      .delete()
      .eq("user_id", userId)
      .eq("task_id", taskId)
      .eq("source", "task")

    if (deleteScheduleEventsError) {
      throw new Error(deleteScheduleEventsError.message)
    }
  }

  const { data, error } = await adminClient
    .from("tasks")
    .update(updatePayload)
    .eq("id", taskId)
    .eq("user_id", userId)
    .select(TASK_SELECT)
    .maybeSingle<TaskRow>()

  if (error) {
    throw new Error(error.message)
  }

  if (!data) {
    return { ok: false, reason: "not_found" }
  }

  const externalWrite =
    fields.status === "completed"
      ? await markCanvasTaskComplete({ adminClient, userId, task: data })
      : null

  // Notion two-way write-back (best-effort side effects; a Notion hiccup never
  // fails the local update).
  if (fields.status === "completed" || fields.status === "todo") {
    await syncNotionTaskCompletion({
      adminClient,
      userId,
      task: data,
      completed: fields.status === "completed",
    }).catch(() => null)
  }

  if (fields.title !== undefined || fields.deadline !== undefined) {
    await syncNotionTaskFields({ adminClient, userId, task: data }).catch(() => null)
  }

  return { ok: true, task: mapTaskRowToTask(data), externalWrite }
}

export interface CreateTaskFields {
  title: string
  description?: string | null
  deadline?: string | null
  durationMinutes?: number | null
  priority?: Priority
  status?: TaskStatus
  isImmutable?: boolean
  allDay?: boolean
  scheduledFor?: string | null
  tags?: string[]
}

/**
 * Create a JARVIS-owned task on the Tasks calendar. Mirrors the assistant's
 * existing create path but accepts the full field set the agent can populate
 * (deadline, scheduledFor, duration, immutability) — e.g. a timed extracted event
 * becomes an immutable, deadline-less task-block per the data-model decision.
 */
export async function createTaskForUser(input: {
  adminClient: SupabaseClient
  userId: string
  fields: CreateTaskFields
}): Promise<Task> {
  const { adminClient, userId, fields } = input

  const { data, error } = await adminClient
    .from("tasks")
    .insert({
      user_id: userId,
      title: fields.title,
      description: fields.description ?? null,
      deadline: fields.deadline ?? null,
      duration_minutes: fields.durationMinutes ?? null,
      priority: fields.priority ?? "medium",
      status: fields.status ?? "todo",
      scheduled_for: fields.scheduledFor ?? null,
      is_immutable: fields.isImmutable ?? false,
      all_day: fields.allDay ?? false,
      calendar_id: TASKS_CALENDAR_ID,
      tags: fields.tags ?? [],
      last_synced_from: "local",
    })
    .select(TASK_SELECT)
    .single<TaskRow>()

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create task.")
  }

  return mapTaskRowToTask(data)
}
