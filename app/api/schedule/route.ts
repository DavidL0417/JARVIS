// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { NextResponse } from "next/server"

import {
  mapPreferencesRowToPreferences,
  mapScheduleEventInputToScheduleEvent,
  mapTaskRowToTask,
} from "@/lib/data/mappers"
import { generateSchedule } from "@/lib/ai/claude"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { TASKS_CALENDAR_ID } from "@/lib/tasks-calendar"
import {
  schedulePlanResultSchema,
  schedulePreparationContextSchema,
  scheduleRequestSchema,
  scheduleResponseSchema,
} from "@/schemas/schedule"
import type { ScheduleEventInsertRow, SchedulePreparationContext, ScheduleResponse } from "@/types"

async function persistSchedulePlan(
  adminClient: Awaited<ReturnType<typeof requireAuthenticatedUser>>["adminClient"],
  userId: string,
  context: SchedulePreparationContext,
  schedule: ScheduleResponse["schedule"],
) {
  const selectedTaskIds = context.tasks.map((task) => task.id)

  if (selectedTaskIds.length === 0) {
    return
  }

  const now = new Date().toISOString()
  const selectedTaskIdSet = new Set(selectedTaskIds)
  const taskEvents = schedule.proposedEvents.filter(
    (event) =>
      event.source === "task" &&
      event.taskId &&
      selectedTaskIdSet.has(event.taskId),
  )

  const { data: existingTaskEvents, error: existingTaskEventsError } = await adminClient
    .from("schedule_events")
    .select("id, task_id, is_immutable")
    .eq("user_id", userId)
    .eq("source", "task")
    .in("task_id", selectedTaskIds)

  if (existingTaskEventsError) {
    throw new Error(existingTaskEventsError.message)
  }

  const mutableEventIds = (existingTaskEvents ?? [])
    .filter((event) => event.is_immutable === false)
    .map((event) => event.id)

  if (mutableEventIds.length > 0) {
    const { error } = await adminClient
      .from("schedule_events")
      .delete()
      .in("id", mutableEventIds)

    if (error) {
      throw new Error(error.message)
    }
  }

  const rowsToUpsert: ScheduleEventInsertRow[] = taskEvents.map((event) => ({
    user_id: userId,
    task_id: event.taskId,
    title: event.title,
    starts_at: event.start,
    ends_at: event.end,
    source: "task",
    priority: event.priority,
    status: "scheduled",
    location: event.location,
    external_event_id: event.externalEventId,
    gcal_event_id: event.gcalEventId,
    last_synced_from: event.lastSyncedFrom,
    is_immutable: event.isImmutable,
    is_checked_in: event.isCheckedIn,
    all_day: false,
    calendar_id: event.calendarId ?? TASKS_CALENDAR_ID,
  }))

  if (rowsToUpsert.length > 0) {
    const { error } = await adminClient
      .from("schedule_events")
      .upsert(rowsToUpsert, { onConflict: "user_id,task_id,source" })

    if (error) {
      throw new Error(error.message)
    }
  }

  const selectedTaskMap = new Map(context.tasks.map((task) => [task.id, task]))
  const eventByTaskId = new Map(
    taskEvents
      .filter((event): event is typeof event & { taskId: string } => Boolean(event.taskId))
      .map((event) => [event.taskId, event]),
  )

  await Promise.all(
    selectedTaskIds.map(async (taskId) => {
      const task = selectedTaskMap.get(taskId)

      if (!task) {
        return
      }

      const taskEvent = eventByTaskId.get(taskId)

      if (!taskEvent) {
        if (task.isImmutable && task.scheduledFor) {
          return
        }

        const { error } = await adminClient
          .from("tasks")
          .update({
            scheduled_for: null,
            status: task.status === "completed" ? "completed" : "todo",
            updated_at: now,
          })
          .eq("id", taskId)
          .eq("user_id", userId)

        if (error) {
          throw new Error(error.message)
        }

        return
      }

      const { error } = await adminClient
        .from("tasks")
        .update({
          scheduled_for: taskEvent.start,
          status: "scheduled",
          updated_at: now,
        })
        .eq("id", taskId)
        .eq("user_id", userId)

      if (error) {
        throw new Error(error.message)
      }
    }),
  )
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsedBody = scheduleRequestSchema.safeParse(body)

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid schedule request",
        issues: parsedBody.error.flatten(),
      },
      { status: 400 },
    )
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()

    let taskQuery = adminClient
      .from("tasks")
      .select(
        "id, user_id, title, description, deadline, duration_minutes, priority, status, scheduled_for, created_at, updated_at, is_immutable, all_day, calendar_id, tags",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })

    if (parsedBody.data.taskIds.length > 0) {
      taskQuery = taskQuery.in("id", parsedBody.data.taskIds)
    }

    const [tasksResult, preferencesResult] = await Promise.all([
      taskQuery,
      adminClient
        .from("preferences")
        .select(
          "id, user_id, timezone, sleep_pattern, peak_energy_window, procrastination_pattern, workday_start, workday_end, default_task_duration_minutes, break_duration_minutes, preferred_focus_block_minutes, preferred_checkin_mode, calendar_id, created_at, updated_at",
        )
        .eq("user_id", user.id)
        .maybeSingle(),
    ])

    if (tasksResult.error || preferencesResult.error) {
      throw new Error(tasksResult.error?.message || preferencesResult.error?.message || "Failed to read scheduling context.")
    }

    const selectedTaskIds = new Set((tasksResult.data || []).map((task) => task.id))
    const scheduleContext: SchedulePreparationContext = {
      userId: user.id,
      tasks: (tasksResult.data || []).map(mapTaskRowToTask),
      preferences: mapPreferencesRowToPreferences(preferencesResult.data),
      hardEvents: parsedBody.data.hardEvents
        .filter((event) => {
          if (!event.taskId) {
            return true
          }

          return !selectedTaskIds.has(event.taskId)
        })
        .map((event) => mapScheduleEventInputToScheduleEvent(event, user.id)),
    }

    const parsedContext = schedulePreparationContextSchema.safeParse(scheduleContext)

    if (!parsedContext.success) {
      return NextResponse.json(
        {
          error: "Invalid schedule preparation context",
          issues: parsedContext.error.flatten(),
        },
        { status: 500 },
      )
    }

    // Future flow: frontend -> /api/schedule -> supabase read -> generateSchedule() -> validate -> DB write.
    // `isImmutable` and `calendarId` are threaded through the planner context now, but the stub planner only preserves them in-memory.
    const plannerResult = await generateSchedule(parsedContext.data)
    const parsedPlannerResult = schedulePlanResultSchema.safeParse(plannerResult)

    if (!parsedPlannerResult.success) {
      return NextResponse.json(
        {
          error: "Invalid schedule planner result",
          issues: parsedPlannerResult.error.flatten(),
        },
        { status: 500 },
      )
    }

    await persistSchedulePlan(
      adminClient,
      user.id,
      parsedContext.data,
      parsedPlannerResult.data,
    )

    const responsePayload: ScheduleResponse = {
      success: true,
      message: "Schedule generated from Supabase context and persisted back into Task Calendar blocks.",
      context: {
        userId: user.id,
        taskCount: parsedContext.data.tasks.length,
        hardEventCount: parsedContext.data.hardEvents.length,
        hasPreferences: parsedContext.data.preferences !== null,
      },
      schedule: parsedPlannerResult.data,
    }

    const parsedResponse = scheduleResponseSchema.safeParse(responsePayload)

    if (!parsedResponse.success) {
      return NextResponse.json(
        {
          error: "Invalid schedule response payload",
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
        error: "Failed to prepare schedule context.",
        details: error instanceof Error ? error.message : "Unknown schedule error.",
      },
      { status: 500 },
    )
  }
}

// ##### END BACKEND #####
