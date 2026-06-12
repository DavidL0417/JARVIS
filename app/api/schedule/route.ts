import { NextResponse } from "next/server"

import { generateSchedule } from "@/lib/ai/claude"
import {
  mapMemoryItemRowToSummary,
  mapPreferencesRowToPreferences,
  mapScheduleEventInputToScheduleEvent,
  mapScheduleEventRowToScheduleEvent,
  mapSourceSnapshotRowToSummary,
  mapTaskRowToTask,
  MEMORY_ITEM_SELECT,
  PREFERENCES_SELECT,
  SOURCE_SNAPSHOT_SELECT,
  TASK_SELECT,
} from "@/lib/data/mappers"
import { listScheduleEventRowsInWindow } from "@/lib/supabase/schedule-events"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { TASKS_CALENDAR_ID } from "@/lib/task-calendar-constants"
import {
  schedulePlanResultSchema,
  schedulePreparationContextSchema,
  scheduleRequestSchema,
  scheduleResponseSchema,
} from "@/schemas/schedule"
import type {
  MemoryItemRow,
  ScheduleEvent,
  ScheduleEventInsertRow,
  ScheduleEventRow,
  SchedulePreparationContext,
  ScheduleResponse,
  SourceSnapshotRow,
  TaskRow,
  UserPreferencesRow,
} from "@/types"

function getEventIdentity(event: Pick<ScheduleEvent, "calendarId" | "title" | "start" | "end" | "location">) {
  return [event.calendarId ?? "", event.title, event.start, event.end, event.location ?? ""].join("::")
}

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

  const rowsToInsert: ScheduleEventInsertRow[] = taskEvents.map((event) => ({
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

  if (rowsToInsert.length > 0) {
    const { error } = await adminClient.from("schedule_events").insert(rowsToInsert)

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
      .select(TASK_SELECT)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })

    if (parsedBody.data.taskIds.length > 0) {
      taskQuery = taskQuery.in("id", parsedBody.data.taskIds)
    }

    const [tasksResult, preferencesResult, eventsResult, memoryResult, sourceResult] = await Promise.all([
      taskQuery,
      adminClient
        .from("preferences")
        .select(PREFERENCES_SELECT)
        .eq("user_id", user.id)
        .maybeSingle<UserPreferencesRow>(),
      // Windowed + paginated: the unbounded read hit Supabase's 1000-row cap, so the
      // planner saw months of history but NO upcoming events (they fell past the cap).
      listScheduleEventRowsInWindow(adminClient, user.id, { lookbackDays: 7, lookaheadDays: 180 }),
      adminClient
        .from("memory_items")
        .select(MEMORY_ITEM_SELECT)
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(20),
      adminClient
        .from("source_snapshots")
        .select(SOURCE_SNAPSHOT_SELECT)
        .eq("user_id", user.id)
        .order("captured_at", { ascending: false })
        .limit(10),
    ])

    if (
      tasksResult.error ||
      preferencesResult.error ||
      eventsResult.error ||
      memoryResult.error ||
      sourceResult.error
    ) {
      throw new Error(
        tasksResult.error?.message ||
          preferencesResult.error?.message ||
          eventsResult.error?.message ||
          memoryResult.error?.message ||
          sourceResult.error?.message ||
          "Failed to read scheduling context.",
      )
    }

    const selectedTaskIds = new Set((tasksResult.data || []).map((task) => (task as TaskRow).id))
    const requestHardEvents = parsedBody.data.hardEvents
      .filter((event) => !event.taskId || !selectedTaskIds.has(event.taskId))
      .map((event) => mapScheduleEventInputToScheduleEvent(event, user.id))
    const requestHardEventKeys = new Set(requestHardEvents.map(getEventIdentity))
    const persistedHardEvents = (eventsResult.data || [])
      .map((event) => mapScheduleEventRowToScheduleEvent(event as ScheduleEventRow))
      .filter((event) => !event.taskId || !selectedTaskIds.has(event.taskId))
      .filter((event) => !requestHardEventKeys.has(getEventIdentity(event)))

    const scheduleContext: SchedulePreparationContext = {
      userId: user.id,
      tasks: (tasksResult.data || []).map((row) => mapTaskRowToTask(row as TaskRow)),
      preferences: mapPreferencesRowToPreferences(preferencesResult.data),
      hardEvents: [...requestHardEvents, ...persistedHardEvents],
      memoryEntries: (memoryResult.data || []).map((row) => mapMemoryItemRowToSummary(row as MemoryItemRow)),
      sourceSnapshots: (sourceResult.data || []).map((row) => mapSourceSnapshotRowToSummary(row as SourceSnapshotRow)),
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

    const plannerResult = await generateSchedule(parsedContext.data, {
      modelKey: parsedBody.data.plannerModel,
    })
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
      message: "Schedule generated from Supabase context and persisted.",
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
