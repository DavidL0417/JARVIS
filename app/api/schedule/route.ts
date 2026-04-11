// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { NextResponse } from "next/server"

import { mapPreferenceRowToUserPreferences, mapTaskRowToTask } from "@/lib/data/mappers"
import { generateSchedule } from "@/lib/ai/claude"
import { getOrCreateDemoUser } from "@/lib/supabase/demo-user"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import {
  schedulePlanResultSchema,
  schedulePreparationContextSchema,
  scheduleRequestSchema,
  scheduleResponseSchema,
} from "@/schemas/schedule"
import type { SchedulePreparationContext, ScheduleResponse } from "@/types"

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
    const supabase = createSupabaseAdminClient()
    const user = await getOrCreateDemoUser(supabase)

    let taskQuery = supabase
      .from("tasks")
      .select("id, title, description, deadline, duration_minutes, priority, status, scheduled_for")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })

    if (parsedBody.data.taskIds.length > 0) {
      taskQuery = taskQuery.in("id", parsedBody.data.taskIds)
    }

    const [tasksResult, preferencesResult] = await Promise.all([
      taskQuery,
      supabase
        .from("preferences")
        .select(
          "timezone, sleep_pattern, peak_energy_window, procrastination_pattern, workday_start, workday_end, default_task_duration_minutes, break_duration_minutes, preferred_focus_block_minutes, preferred_checkin_mode, calendar_id",
        )
        .eq("user_id", user.id)
        .maybeSingle(),
    ])

    if (tasksResult.error || preferencesResult.error) {
      throw new Error(tasksResult.error?.message || preferencesResult.error?.message || "Failed to read scheduling context.")
    }

    const scheduleContext: SchedulePreparationContext = {
      userId: user.id,
      tasks: (tasksResult.data || []).map(mapTaskRowToTask),
      preferences: mapPreferenceRowToUserPreferences(preferencesResult.data),
      hardEvents: parsedBody.data.hardEvents,
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

    const responsePayload: ScheduleResponse = {
      success: true,
      message: "Schedule context prepared from Supabase. Planner output is still a validated stub.",
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

    // TODO: This route is intentionally stubbed after planner validation until schedule_events writes are finalized.
    return NextResponse.json(parsedResponse.data)
  } catch (error) {
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
