// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { createSupabaseAdminClient } from "@/lib/supabase/server"
import {
  buildTaskReminderDescription,
  getTaskDueTimeLabel,
  isTaskCalendarKey,
  TASKS_CALENDAR_COLOR,
  TASKS_CALENDAR_ID,
  TASKS_CALENDAR_MEMORY,
  TASKS_CALENDAR_NAME,
} from "@/lib/task-calendar-constants"
import type { Task, UserCalendar, UserCalendarRow } from "@/types"

const GOOGLE_API_TIMEOUT_MS = 15_000
const MISSING_USER_CALENDARS_TABLE_HINT =
  "Calendar registry is unavailable because public.user_calendars has not been applied in Supabase yet."

type StoredGoogleIntegrationRow = {
  access_token: string | null
  refresh_token: string | null
  expires_at: string | null
}

type GoogleCalendarListItem = {
  id?: string
  summary?: string
}

type GoogleCalendarListResponse = {
  items?: GoogleCalendarListItem[]
}

type GoogleTokenRefreshResponse = {
  access_token?: string
  expires_in?: number
}

function buildTaskCalendarRow(userId: string) {
  return {
    user_id: userId,
    calendar_key: TASKS_CALENDAR_ID,
    name: TASKS_CALENDAR_NAME,
    color: TASKS_CALENDAR_COLOR,
    source: "task" as const,
    is_visible: true,
    is_immutable: false,
    sync_preference: "active" as const,
    is_task_calendar: true,
    updated_at: new Date().toISOString(),
  }
}

function buildFallbackTaskCalendar(userId: string): UserCalendar {
  return {
    id: "fallback-task-calendar",
    userId,
    calendarKey: TASKS_CALENDAR_ID,
    name: TASKS_CALENDAR_NAME,
    color: TASKS_CALENDAR_COLOR,
    source: "task",
    googleCalendarId: null,
    remoteName: null,
    isVisible: true,
    isImmutable: false,
    syncPreference: "active",
    isTaskCalendar: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }
}

function mapStoredUserCalendarRow(row: UserCalendarRow): UserCalendar {
  return {
    id: row.id,
    userId: row.user_id,
    calendarKey: row.calendar_key,
    name: row.name,
    color: row.color,
    source: row.source,
    googleCalendarId: row.google_calendar_id,
    remoteName: row.remote_name,
    isVisible: row.is_visible,
    isImmutable: row.is_immutable,
    syncPreference: row.sync_preference,
    isTaskCalendar: row.is_task_calendar,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function isMissingUserCalendarsTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)

  return (
    message.includes("public.user_calendars") &&
    (message.includes("schema cache") || message.includes("does not exist"))
  )
}

export function getMissingUserCalendarsTableHint() {
  return MISSING_USER_CALENDARS_TABLE_HINT
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs = GOOGLE_API_TIMEOUT_MS,
) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

async function getStoredGoogleIntegration(userId: string) {
  const adminClient = createSupabaseAdminClient()
  const { data, error } = await adminClient
    .from("user_integrations")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .eq("provider", "google")
    .maybeSingle<StoredGoogleIntegrationRow>()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

async function refreshGoogleAccessToken(userId: string, refreshToken: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return null
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  })

  const response = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  })

  if (!response.ok) {
    return null
  }

  const payload = (await response.json()) as GoogleTokenRefreshResponse

  if (!payload.access_token) {
    return null
  }

  const expiresAt =
    typeof payload.expires_in === "number"
      ? new Date(Date.now() + payload.expires_in * 1_000).toISOString()
      : null

  const adminClient = createSupabaseAdminClient()
  await adminClient
    .from("user_integrations")
    .update({
      access_token: payload.access_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("provider", "google")

  return payload.access_token
}

async function resolveGoogleAccessToken(userId: string) {
  const integration = await getStoredGoogleIntegration(userId)

  if (!integration) {
    return null
  }

  if (integration.access_token) {
    const expiresAt = integration.expires_at ? new Date(integration.expires_at).getTime() : null

    if (!expiresAt || expiresAt > Date.now() + 60_000) {
      return integration.access_token
    }
  }

  if (!integration.refresh_token) {
    return integration.access_token
  }

  return refreshGoogleAccessToken(userId, integration.refresh_token)
}

async function listGoogleCalendars(accessToken: string) {
  const response = await fetchWithTimeout(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    },
  )

  if (!response.ok) {
    throw new Error(`Google calendar list failed with status ${response.status}.`)
  }

  const payload = (await response.json()) as GoogleCalendarListResponse
  return payload.items ?? []
}

async function createGoogleTaskCalendar(accessToken: string) {
  const response = await fetchWithTimeout("https://www.googleapis.com/calendar/v3/calendars", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary: TASKS_CALENDAR_NAME,
    }),
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error(`Google task calendar creation failed with status ${response.status}.`)
  }

  return (await response.json()) as GoogleCalendarListItem
}

async function ensureGoogleTaskCalendar(userId: string, currentCalendar: UserCalendar) {
  if (currentCalendar.googleCalendarId) {
    return currentCalendar
  }

  const accessToken = await resolveGoogleAccessToken(userId)

  if (!accessToken) {
    return currentCalendar
  }

  const existingCalendars = await listGoogleCalendars(accessToken)
  const matchedCalendar =
    existingCalendars.find((calendar) => calendar.id === currentCalendar.googleCalendarId) ||
    existingCalendars.find((calendar) => calendar.summary?.trim() === TASKS_CALENDAR_NAME) ||
    (await createGoogleTaskCalendar(accessToken))

  if (!matchedCalendar.id) {
    return currentCalendar
  }

  const adminClient = createSupabaseAdminClient()
  const { data, error } = await adminClient
    .from("user_calendars")
    .update({
      google_calendar_id: matchedCalendar.id,
      remote_name: matchedCalendar.summary ?? TASKS_CALENDAR_NAME,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("calendar_key", TASKS_CALENDAR_ID)
    .select(
      "id, user_id, calendar_key, name, color, source, google_calendar_id, remote_name, is_visible, is_immutable, sync_preference, is_task_calendar, created_at, updated_at",
    )
    .single<UserCalendarRow>()

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to persist Task Calendar Google mirror.")
  }

  return mapStoredUserCalendarRow(data)
}

export async function ensureTaskCalendarForUser(userId: string) {
  const adminClient = createSupabaseAdminClient()
  const { data, error } = await adminClient
    .from("user_calendars")
    .upsert(buildTaskCalendarRow(userId), { onConflict: "user_id,calendar_key" })
    .select(
      "id, user_id, calendar_key, name, color, source, google_calendar_id, remote_name, is_visible, is_immutable, sync_preference, is_task_calendar, created_at, updated_at",
    )
    .single<UserCalendarRow>()

  if (error || !data) {
    if (isMissingUserCalendarsTableError(error)) {
      console.warn(MISSING_USER_CALENDARS_TABLE_HINT)
      return buildFallbackTaskCalendar(userId)
    }

    throw new Error(error?.message ?? "Failed to initialize the Task Calendar.")
  }

  const calendar = mapStoredUserCalendarRow(data)

  try {
    return await ensureGoogleTaskCalendar(userId, calendar)
  } catch (error) {
    console.error("Failed to mirror Task Calendar to Google Calendar", error)
    return calendar
  }
}

export async function listUserCalendars(userId: string) {
  const adminClient = createSupabaseAdminClient()
  const { data, error } = await adminClient
    .from("user_calendars")
    .select(
      "id, user_id, calendar_key, name, color, source, google_calendar_id, remote_name, is_visible, is_immutable, sync_preference, is_task_calendar, created_at, updated_at",
    )
    .eq("user_id", userId)
    .order("is_task_calendar", { ascending: false })
    .order("name", { ascending: true })

  if (error) {
    if (isMissingUserCalendarsTableError(error)) {
      console.warn(MISSING_USER_CALENDARS_TABLE_HINT)
      return [buildFallbackTaskCalendar(userId)]
    }

    throw new Error(error.message)
  }

  return (data ?? []).map(mapStoredUserCalendarRow)
}

export { buildTaskReminderDescription, getTaskDueTimeLabel, isTaskCalendarKey }

// ##### END BACKEND #####
