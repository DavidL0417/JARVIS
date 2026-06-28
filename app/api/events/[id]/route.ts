import { NextResponse } from "next/server"
import { z } from "zod"

import {
  mapScheduleEventRowToScheduleEvent,
  SCHEDULE_EVENT_SELECT,
} from "@/lib/data/mappers"
import { deleteTaskEventFromGoogle } from "@/lib/google-calendar-events"
import { archiveNotionPageForTask } from "@/lib/sources/notion-completion"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { applyTaskUpdate } from "@/lib/tasks/mutations"
import {
  scheduleEventUpdateRequestSchema,
  scheduleEventUpdateResponseSchema,
} from "@/schemas/schedule"
import type { ScheduleEventRow, TaskRow } from "@/types"

const eventIdSchema = z.string().uuid()

async function getValidatedEventId(params: Promise<{ id: string }>) {
  const { id } = await params
  return eventIdSchema.safeParse(id)
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsedEventId = await getValidatedEventId(context.params)
  const body = await request.json().catch(() => null)
  const parsedBody = scheduleEventUpdateRequestSchema.safeParse(body)

  if (!parsedEventId.success) {
    return NextResponse.json({ error: "Invalid event id." }, { status: 400 })
  }

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid event update request",
        issues: parsedBody.error.flatten(),
      },
      { status: 400 },
    )
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const now = new Date().toISOString()
    const updatePayload = {
      ...(parsedBody.data.priority ? { priority: parsedBody.data.priority } : {}),
      ...(parsedBody.data.isImmutable !== undefined
        ? { is_immutable: parsedBody.data.isImmutable }
        : {}),
      is_checked_in: true,
      updated_at: now,
    }

    const { data: updatedEvent, error: updateEventError } = await adminClient
      .from("schedule_events")
      .update(updatePayload)
      .eq("id", parsedEventId.data)
      .eq("user_id", user.id)
      .select(SCHEDULE_EVENT_SELECT)
      .maybeSingle<ScheduleEventRow>()

    if (updateEventError) {
      throw new Error(updateEventError.message)
    }

    if (!updatedEvent) {
      return NextResponse.json({ error: "Event not found." }, { status: 404 })
    }

    if (updatedEvent.task_id) {
      const taskUpdatePayload = {
        ...(parsedBody.data.priority ? { priority: parsedBody.data.priority } : {}),
        ...(parsedBody.data.isImmutable !== undefined
          ? { is_immutable: parsedBody.data.isImmutable }
          : {}),
        updated_at: now,
      }
      const { error: updateTaskError } = await adminClient
        .from("tasks")
        .update(taskUpdatePayload)
        .eq("id", updatedEvent.task_id)
        .eq("user_id", user.id)

      if (updateTaskError) {
        throw new Error(updateTaskError.message)
      }
    }

    const responsePayload = {
      success: true,
      event: mapScheduleEventRowToScheduleEvent(updatedEvent),
    }
    const parsedResponse = scheduleEventUpdateResponseSchema.safeParse(responsePayload)

    if (!parsedResponse.success) {
      return NextResponse.json(
        {
          error: "Invalid event update response payload",
          issues: parsedResponse.error.flatten(),
        },
        { status: 500 },
      )
    }

    return NextResponse.json(parsedResponse.data)
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to update event.",
        details: error instanceof Error ? error.message : "Unknown event update error.",
      },
      { status: 500 },
    )
  }
}

// Remove a JARVIS-scheduled task block from the calendar. Two intents, chosen by
// the `mode` query param:
//   - "unschedule" (default): drop the block, return the task to the unscheduled
//     to-do pool (status → todo, scheduled_for → null). Reuses applyTaskUpdate so
//     it matches the task rail's "Unschedule" exactly.
//   - "task": delete the underlying task entirely (block + task + Notion archive).
// Either way the Google Calendar mirror is removed first so the block doesn't
// linger on the user's phone / re-import. Scoped to source="task" blocks; imported
// external events are not deletable here (CalDAV write is deferred).
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsedEventId = await getValidatedEventId(context.params)

  if (!parsedEventId.success) {
    return NextResponse.json({ error: "Invalid event id." }, { status: 400 })
  }

  const mode = new URL(request.url).searchParams.get("mode") === "task" ? "task" : "unschedule"

  try {
    const { adminClient, user } = await requireAuthenticatedUser()

    const { data: eventRow, error: loadError } = await adminClient
      .from("schedule_events")
      .select("id, task_id, gcal_event_id, source, is_immutable")
      .eq("id", parsedEventId.data)
      .eq("user_id", user.id)
      .maybeSingle<Pick<ScheduleEventRow, "id" | "task_id" | "gcal_event_id" | "source" | "is_immutable">>()

    if (loadError) {
      throw new Error(loadError.message)
    }

    if (!eventRow) {
      return NextResponse.json({ error: "Event not found." }, { status: 404 })
    }

    if (eventRow.source !== "task") {
      return NextResponse.json(
        { error: "Only JARVIS-scheduled task blocks can be removed here." },
        { status: 400 },
      )
    }

    // An immutable block is a fixed appointment (e.g. "dinner Fri 7pm"), usually
    // deadline-less. Unscheduling it would degrade it into a floating undated todo,
    // losing the time entirely — so for these, deleting is the only coherent
    // removal. The UI hides "Remove from calendar" for immutable blocks; this is
    // the backstop.
    if (mode === "unschedule" && eventRow.is_immutable) {
      return NextResponse.json(
        { error: "This is a fixed block. Delete it instead of unscheduling." },
        { status: 400 },
      )
    }

    const taskId = eventRow.task_id

    // Collect every Google mirror that will be orphaned by this delete. When a
    // task is involved we clear all of its blocks (a task can be placed more than
    // once); otherwise just this one row.
    const mirrors: string[] = []
    if (taskId) {
      const { data: blocks, error: blocksError } = await adminClient
        .from("schedule_events")
        .select("gcal_event_id")
        .eq("user_id", user.id)
        .eq("task_id", taskId)
        .eq("source", "task")

      if (blocksError) {
        throw new Error(blocksError.message)
      }

      for (const block of blocks ?? []) {
        if (block.gcal_event_id) {
          mirrors.push(block.gcal_event_id)
        }
      }
    } else if (eventRow.gcal_event_id) {
      mirrors.push(eventRow.gcal_event_id)
    }

    // Best-effort: a Google hiccup must not block the local removal.
    for (const gcalEventId of mirrors) {
      await deleteTaskEventFromGoogle(user.id, gcalEventId).catch(() => null)
    }

    if (mode === "task" && taskId) {
      const { error: deleteEventsError } = await adminClient
        .from("schedule_events")
        .delete()
        .eq("user_id", user.id)
        .eq("task_id", taskId)

      if (deleteEventsError) {
        throw new Error(deleteEventsError.message)
      }

      const { data: deletedTask, error: deleteTaskError } = await adminClient
        .from("tasks")
        .delete()
        .eq("id", taskId)
        .eq("user_id", user.id)
        .select("id, title, external_task_id, last_synced_from")
        .maybeSingle<Pick<TaskRow, "id" | "title" | "external_task_id" | "last_synced_from">>()

      if (deleteTaskError) {
        throw new Error(deleteTaskError.message)
      }

      // Notion two-way write-back: archive the linked Notion page so it stays in
      // sync. Best-effort side effect.
      if (deletedTask) {
        await archiveNotionPageForTask({ adminClient, userId: user.id, task: deletedTask }).catch(() => null)
      }

      return NextResponse.json({ success: true, mode, taskDeleted: true })
    }

    // Unschedule: hand off to applyTaskUpdate, which deletes the task's blocks and
    // resets it to todo. Falls through to a bare row delete if the block somehow
    // has no task.
    if (taskId) {
      const result = await applyTaskUpdate({
        adminClient,
        userId: user.id,
        taskId,
        fields: { status: "todo", scheduledFor: null },
      })

      if (!result.ok) {
        return NextResponse.json({ error: "Task not found." }, { status: 404 })
      }
    } else {
      const { error: deleteRowError } = await adminClient
        .from("schedule_events")
        .delete()
        .eq("id", parsedEventId.data)
        .eq("user_id", user.id)

      if (deleteRowError) {
        throw new Error(deleteRowError.message)
      }
    }

    return NextResponse.json({ success: true, mode, taskDeleted: false })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to remove event.",
        details: error instanceof Error ? error.message : "Unknown event delete error.",
      },
      { status: 500 },
    )
  }
}
