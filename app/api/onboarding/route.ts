// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { NextResponse } from "next/server"

import {
  mapOnboardingTaskInputToTaskInsert,
  mapPreferencesToUpsert,
} from "@/lib/data/mappers"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { onboardingRequestSchema, onboardingResponseSchema } from "@/schemas/onboarding"
import type { OnboardingResponse, UserPreferences } from "@/types"

const DEFAULT_PREFERENCES: UserPreferences = {
  userId: "",
  timezone: "America/Chicago",
  sleepPattern: null,
  peakEnergyWindow: null,
  procrastinationPattern: null,
  workdayStart: "09:00",
  workdayEnd: "17:00",
  defaultTaskDurationMinutes: 50,
  breakDurationMinutes: 10,
  preferredFocusBlockMinutes: null,
  preferredCheckInMode: "quiet",
  calendarId: null,
  plannerHorizonDays: 28,
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
    const { adminClient, user } = await requireAuthenticatedUser({
      profileOverrides: {
        name: parsedBody.data.name,
      },
    })
    const mergedPreferences: UserPreferences = {
      ...DEFAULT_PREFERENCES,
      userId: user.id,
      ...parsedBody.data.preferences,
      timezone: parsedBody.data.preferences?.timezone || parsedBody.data.timezone,
    }

    const { data: preferenceRecord, error: preferenceError } = await adminClient
      .from("preferences")
      .upsert(mapPreferencesToUpsert(mergedPreferences), { onConflict: "user_id" })
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
          isImmutable: false,
          calendarId: null,
          tags: [],
          priority: "medium" as const,
          status: "todo" as const,
        }))

    let taskIds: string[] = []

    if (onboardingTasks.length > 0) {
      const { data: insertedTasks, error: taskError } = await adminClient
        .from("tasks")
        .insert(
          onboardingTasks.map((task) =>
            mapOnboardingTaskInputToTaskInsert(
              task,
              user.id,
              mergedPreferences.defaultTaskDurationMinutes,
            ),
          ),
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
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

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
