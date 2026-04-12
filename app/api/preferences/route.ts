// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"

import { mapPreferencesRowToPreferences, mapPreferencesToUpsert } from "@/lib/data/mappers"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import {
  preferencesResponseSchema,
  updatePreferencesRequestSchema,
} from "@/schemas/preferences"
import type { PreferencesResponse, UpdatePreferencesRequest, UserPreferences, UserPreferencesRow } from "@/types"

function buildDefaultPreferences(userId: string): UserPreferences {
  return {
    userId,
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
  }
}

function mergePreferences(
  existing: UserPreferences,
  updates: UpdatePreferencesRequest,
): UserPreferences {
  return {
    userId: existing.userId,
    timezone: updates.timezone ?? existing.timezone,
    sleepPattern: updates.sleepPattern ?? existing.sleepPattern,
    peakEnergyWindow: updates.peakEnergyWindow ?? existing.peakEnergyWindow,
    procrastinationPattern: updates.procrastinationPattern ?? existing.procrastinationPattern,
    workdayStart: updates.workdayStart ?? existing.workdayStart,
    workdayEnd: updates.workdayEnd ?? existing.workdayEnd,
    defaultTaskDurationMinutes:
      updates.defaultTaskDurationMinutes ?? existing.defaultTaskDurationMinutes,
    breakDurationMinutes: updates.breakDurationMinutes ?? existing.breakDurationMinutes,
    preferredFocusBlockMinutes:
      updates.preferredFocusBlockMinutes ?? existing.preferredFocusBlockMinutes,
    preferredCheckInMode: updates.preferredCheckInMode ?? existing.preferredCheckInMode,
    calendarId: updates.calendarId ?? existing.calendarId,
  }
}

async function getOrCreatePreferences(adminClient: SupabaseClient, userId: string) {
  const { data, error } = await adminClient
    .from("preferences")
    .select(
      "id, user_id, timezone, sleep_pattern, peak_energy_window, procrastination_pattern, workday_start, workday_end, default_task_duration_minutes, break_duration_minutes, preferred_focus_block_minutes, preferred_checkin_mode, calendar_id, created_at, updated_at",
    )
    .eq("user_id", userId)
    .maybeSingle<UserPreferencesRow>()

  if (error) {
    throw new Error(error.message)
  }

  if (data) {
    return mapPreferencesRowToPreferences(data) as UserPreferences
  }

  const defaults = buildDefaultPreferences(userId)
  const { data: inserted, error: insertError } = await adminClient
    .from("preferences")
    .upsert(mapPreferencesToUpsert(defaults), { onConflict: "user_id" })
    .select(
      "id, user_id, timezone, sleep_pattern, peak_energy_window, procrastination_pattern, workday_start, workday_end, default_task_duration_minutes, break_duration_minutes, preferred_focus_block_minutes, preferred_checkin_mode, calendar_id, created_at, updated_at",
    )
    .single<UserPreferencesRow>()

  if (insertError || !inserted) {
    throw new Error(insertError?.message ?? "Failed to initialize preferences.")
  }

  return mapPreferencesRowToPreferences(inserted) as UserPreferences
}

export async function GET() {
  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const preferences = await getOrCreatePreferences(adminClient, user.id)

    const responsePayload: PreferencesResponse = {
      success: true,
      preferences,
    }

    const parsedResponse = preferencesResponseSchema.safeParse(responsePayload)

    if (!parsedResponse.success) {
      return NextResponse.json(
        {
          error: "Invalid preferences response payload",
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
        error: "Failed to load preferences.",
        details: error instanceof Error ? error.message : "Unknown preferences error.",
      },
      { status: 500 },
    )
  }
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null)
  const parsedBody = updatePreferencesRequestSchema.safeParse(body)

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid preferences request",
        issues: parsedBody.error.flatten(),
      },
      { status: 400 },
    )
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const existingPreferences = await getOrCreatePreferences(adminClient, user.id)
    const mergedPreferences = mergePreferences(existingPreferences, parsedBody.data)

    const { data, error } = await adminClient
      .from("preferences")
      .upsert(mapPreferencesToUpsert(mergedPreferences), { onConflict: "user_id" })
      .select(
        "id, user_id, timezone, sleep_pattern, peak_energy_window, procrastination_pattern, workday_start, workday_end, default_task_duration_minutes, break_duration_minutes, preferred_focus_block_minutes, preferred_checkin_mode, calendar_id, created_at, updated_at",
      )
      .single<UserPreferencesRow>()

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to save preferences.")
    }

    const responsePayload: PreferencesResponse = {
      success: true,
      preferences: mapPreferencesRowToPreferences(data) as UserPreferences,
    }

    const parsedResponse = preferencesResponseSchema.safeParse(responsePayload)

    if (!parsedResponse.success) {
      return NextResponse.json(
        {
          error: "Invalid preferences response payload",
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
        error: "Failed to save preferences.",
        details: error instanceof Error ? error.message : "Unknown preferences save error.",
      },
      { status: 500 },
    )
  }
}

// ##### END BACKEND #####
