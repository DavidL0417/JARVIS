// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { NextResponse } from "next/server"

import {
  getCheckInModeFromCount,
  mapScheduleEventRowToScheduleEvent,
  mapTaskRowToTask,
} from "@/lib/data/mappers"
import { createPlaceholderCalendarEvents } from "@/lib/mock-calendar-events"
import { getOrCreateDemoUser } from "@/lib/supabase/demo-user"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { dashboardResponseSchema } from "@/schemas/dashboard"
import type { DashboardResponse, Task } from "@/types"

function pickCurrentTask(tasks: Task[]): DashboardResponse["currentTask"] {
  const scheduledTask = tasks.find((task) => task.status === "scheduled")

  if (scheduledTask) {
    return {
      id: scheduledTask.id,
      title: scheduledTask.title,
      status: scheduledTask.status,
    }
  }

  const todoTask = tasks.find((task) => task.status === "todo")

  if (!todoTask) {
    return null
  }

  return {
    id: todoTask.id,
    title: todoTask.title,
    status: todoTask.status,
  }
}

export async function GET() {
  try {
    const supabase = createSupabaseAdminClient()
    const user = await getOrCreateDemoUser(supabase)

    const [tasksResult, eventsResult, checkinsResult] = await Promise.all([
      supabase
        .from("tasks")
        .select(
          "id, user_id, title, description, deadline, duration_minutes, priority, status, scheduled_for, created_at, updated_at, is_immutable, calendar_id, tags",
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("schedule_events")
        .select(
          "id, user_id, task_id, title, starts_at, ends_at, source, status, location, external_event_id, created_at, updated_at, is_immutable, calendar_id",
        )
        .eq("user_id", user.id)
        .order("starts_at", { ascending: true }),
      supabase.from("checkins").select("id").eq("user_id", user.id).limit(4),
    ])

    if (tasksResult.error || eventsResult.error || checkinsResult.error) {
      throw new Error(
        tasksResult.error?.message ||
          eventsResult.error?.message ||
          checkinsResult.error?.message ||
          "Failed to load dashboard data from Supabase.",
      )
    }

    const tasks = (tasksResult.data || []).map(mapTaskRowToTask)
    const persistedEvents = (eventsResult.data || []).map(mapScheduleEventRowToScheduleEvent)
    const placeholderCalendarEvents = createPlaceholderCalendarEvents(user.id)
    const events = [...placeholderCalendarEvents, ...persistedEvents.filter((event) => event.source !== "calendar")].sort(
      (left, right) => new Date(left.start).getTime() - new Date(right.start).getTime(),
    )
    const scheduledTaskIds = new Set(
      (eventsResult.data || [])
        .map((event) => event.task_id)
        .filter((taskId): taskId is string => typeof taskId === "string" && taskId.length > 0),
    )

    const overdueCount = tasks.filter((task) => {
      if (task.status === "missed") {
        return true
      }

      if (!task.deadline || task.status === "completed") {
        return false
      }

      return new Date(task.deadline).getTime() < Date.now()
    }).length

    const unscheduledCount = tasks.filter((task) => {
      if (task.status === "completed" || task.status === "missed") {
        return false
      }

      return !task.scheduledFor && !scheduledTaskIds.has(task.id)
    }).length

    const dashboardPayload: DashboardResponse = {
      stats: {
        tasks: tasks.length,
        overdue: overdueCount,
        unscheduled: unscheduledCount,
        checkInMode: getCheckInModeFromCount((checkinsResult.data || []).length),
      },
      currentTask: pickCurrentTask(tasks),
      events,
      tasks,
    }

    const parsedPayload = dashboardResponseSchema.safeParse(dashboardPayload)

    if (!parsedPayload.success) {
      return NextResponse.json(
        {
          error: "Invalid dashboard response payload",
          issues: parsedPayload.error.flatten(),
        },
        { status: 500 },
      )
    }

    return NextResponse.json(parsedPayload.data)
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load dashboard data.",
        details: error instanceof Error ? error.message : "Unknown dashboard error.",
      },
      { status: 500 },
    )
  }
}

// ##### END BACKEND #####
