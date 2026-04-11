// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { NextResponse } from "next/server"

import { getOrCreateDemoUser } from "@/lib/supabase/demo-user"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { onboardingRequestSchema, onboardingResponseSchema } from "@/schemas/onboarding"
import type { OnboardingResponse, UserPreferences } from "@/types"

const DEFAULT_PREFERENCES: UserPreferences = {
  timezone: "America/Chicago",
  workdayStart: "09:00",
  workdayEnd: "17:00",
  defaultTaskDurationMinutes: 50,
  breakDurationMinutes: 10,
  preferredCheckInMode: "quiet",
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsedBody = onboardingRequestSchema.safeParse(body)

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid onboarding request",
        issues: parsedBody.error.flatten(),
      },
      { status: 400 },
    )
  }

  try {
    const supabase = createSupabaseAdminClient()

    // MVP note: this route uses a single demo user until auth is wired in.
    const user = await getOrCreateDemoUser(supabase, { name: parsedBody.data.name })
    const mergedPreferences: UserPreferences = {
      ...DEFAULT_PREFERENCES,
      ...parsedBody.data.preferences,
      timezone: parsedBody.data.preferences?.timezone || parsedBody.data.timezone,
    }

    const { data: preferenceRecord, error: preferenceError } = await supabase
      .from("preferences")
      .upsert(
        {
          user_id: user.id,
          timezone: mergedPreferences.timezone,
          sleep_pattern: mergedPreferences.sleepPattern || null,
          peak_energy_window: mergedPreferences.peakEnergyWindow || null,
          procrastination_pattern: mergedPreferences.procrastinationPattern || null,
          workday_start: mergedPreferences.workdayStart,
          workday_end: mergedPreferences.workdayEnd,
          default_task_duration_minutes: mergedPreferences.defaultTaskDurationMinutes,
          break_duration_minutes: mergedPreferences.breakDurationMinutes,
          preferred_focus_block_minutes: mergedPreferences.preferredFocusBlockMinutes || null,
          preferred_checkin_mode: mergedPreferences.preferredCheckInMode || null,
          calendar_id: mergedPreferences.calendarId || null,
        },
        { onConflict: "user_id" },
      )
      .select("id")
      .single<{ id: string }>()

    if (preferenceError) {
      throw new Error(preferenceError.message)
    }

    const onboardingTasks =
      parsedBody.data.tasks.length > 0
        ? parsedBody.data.tasks
        : parsedBody.data.goals.map((goal) => ({
            title: goal,
            description: undefined,
            deadline: null,
            durationMinutes: null,
            priority: "medium" as const,
            status: "todo" as const,
          }))

    let taskIds: string[] = []

    if (onboardingTasks.length > 0) {
      const { data: insertedTasks, error: taskError } = await supabase
        .from("tasks")
        .insert(
          onboardingTasks.map((task) => ({
            user_id: user.id,
            title: task.title,
            description: task.description || null,
            deadline: task.deadline || null,
            duration_minutes: task.durationMinutes || mergedPreferences.defaultTaskDurationMinutes,
            priority: task.priority || "medium",
            status: task.status || "todo",
          })),
        )
        .select("id")

      if (taskError) {
        throw new Error(taskError.message)
      }

      taskIds = (insertedTasks || []).map((task) => task.id)
    }

    const responsePayload: OnboardingResponse = {
      success: true,
      userId: user.id,
      preferenceId: preferenceRecord?.id || null,
      taskIds,
      taskCount: taskIds.length,
    }

    const parsedResponse = onboardingResponseSchema.safeParse(responsePayload)

    if (!parsedResponse.success) {
      return NextResponse.json(
        {
          error: "Invalid onboarding response payload",
          issues: parsedResponse.error.flatten(),
        },
        { status: 500 },
      )
    }

    return NextResponse.json(parsedResponse.data)
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to persist onboarding data.",
        details: error instanceof Error ? error.message : "Unknown onboarding error.",
      },
      { status: 500 },
    )
  }
}

// ##### END BACKEND #####
