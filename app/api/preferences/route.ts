// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"

import { mapPreferencesRowToPreferences, mapPreferencesToUpsert, PREFERENCES_SELECT } from "@/lib/data/mappers"
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
    plannerHorizonDays: 28,
    morningDigestEnabled: true,
    eveningDigestEnabled: true,
    morningDigestTime: "08:30",
    eveningDigestTime: "18:30",
    quietHoursStart: null,
    quietHoursEnd: null,
  }
}

// Nullable fields use an explicit-undefined check (not `??`) so a request can
// clear them back to null — `?? existing` would treat an intentional null as
// "keep the old value", making availability fields and quiet hours un-clearable.
function patchNullable<T>(update: T | null | undefined, existing: T | null): T | null {
  return update === undefined ? existing : update
}

function mergePreferences(
  existing: UserPreferences,
  updates: UpdatePreferencesRequest,
): UserPreferences {
  return {
    userId: existing.userId,
    timezone: updates.timezone ?? existing.timezone,
    sleepPattern: patchNullable(updates.sleepPattern, existing.sleepPattern),
    peakEnergyWindow: patchNullable(updates.peakEnergyWindow, existing.peakEnergyWindow),
    procrastinationPattern: patchNullable(updates.procrastinationPattern, existing.procrastinationPattern),
    workdayStart: updates.workdayStart ?? existing.workdayStart,
    workdayEnd: updates.workdayEnd ?? existing.workdayEnd,
    defaultTaskDurationMinutes:
      updates.defaultTaskDurationMinutes ?? existing.defaultTaskDurationMinutes,
    breakDurationMinutes: updates.breakDurationMinutes ?? existing.breakDurationMinutes,
    preferredFocusBlockMinutes:
      patchNullable(updates.preferredFocusBlockMinutes, existing.preferredFocusBlockMinutes),
    preferredCheckInMode: updates.preferredCheckInMode ?? existing.preferredCheckInMode,
    calendarId: patchNullable(updates.calendarId, existing.calendarId),
    plannerHorizonDays: updates.plannerHorizonDays ?? existing.plannerHorizonDays,
    morningDigestEnabled: updates.morningDigestEnabled ?? existing.morningDigestEnabled,
    eveningDigestEnabled: updates.eveningDigestEnabled ?? existing.eveningDigestEnabled,
    morningDigestTime: updates.morningDigestTime ?? existing.morningDigestTime,
    eveningDigestTime: updates.eveningDigestTime ?? existing.eveningDigestTime,
    quietHoursStart: patchNullable(updates.quietHoursStart, existing.quietHoursStart),
    quietHoursEnd: patchNullable(updates.quietHoursEnd, existing.quietHoursEnd),
  }
}

async function getOrCreatePreferences(adminClient: SupabaseClient, userId: string) {
  const { data, error } = await adminClient
    .from("preferences")
    .select(PREFERENCES_SELECT)
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
    .select(PREFERENCES_SELECT)
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
      .select(PREFERENCES_SELECT)
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
