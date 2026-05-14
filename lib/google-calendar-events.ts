import {
  mapScheduleEventRowToScheduleEvent,
  mapScheduleEventToInsert,
  mapUserCalendarRowToUserCalendar,
  SCHEDULE_EVENT_SELECT,
  USER_CALENDAR_SELECT,
} from "@/lib/data/mappers"
import {
  getStoredGoogleIntegration,
  getValidGoogleAccessToken,
  markGoogleIntegrationStatus,
  updateGoogleLastSyncedAt,
} from "@/lib/supabase/google-calendar-integration"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { recordGoogleCalendarTaskFeedback } from "@/lib/sources/calendar-feedback"
import { TASKS_CALENDAR_ID } from "@/lib/task-calendar-constants"
import type { GoogleCalendarSyncResponse, ScheduleEvent, ScheduleEventRow, UserCalendar, UserCalendarRow } from "@/types"

const DAY_IN_MS = 24 * 60 * 60 * 1000
const GOOGLE_EVENT_LOOKBACK_DAYS = 90
const GOOGLE_EVENT_LOOKAHEAD_DAYS = 180
const GOOGLE_CALENDAR_ID_PREFIX = "google-calendar:"

function isGoogleAuthorizationFailure(message: string) {
  return /authorization|reauthorization|unauthorized|invalid authentication|invalid credentials|status 401|not connected/i.test(
    message,
  )
}

interface GoogleCalendarListItem {
  id?: string
  summary?: string
  backgroundColor?: string
}

interface GoogleCalendarListResponse {
  items?: GoogleCalendarListItem[]
}

interface GoogleCalendarEventDateTime {
  date?: string
  dateTime?: string
}

interface GoogleCalendarEventItem {
  id: string
  summary?: string
  location?: string
  start?: GoogleCalendarEventDateTime
  end?: GoogleCalendarEventDateTime
  status?: string
  extendedProperties?: {
    private?: {
      jarvisEventId?: string
      jarvisTaskId?: string
      source?: string
    }
  }
}

interface GoogleCalendarEventsResponse {
  items?: GoogleCalendarEventItem[]
}

interface GoogleCalendarWriteResponse {
  id?: string
}

function toCalendarKey(googleCalendarId: string) {
  return `${GOOGLE_CALENDAR_ID_PREFIX}${googleCalendarId}`
}

function toEventTimestamp(value: GoogleCalendarEventDateTime | undefined, fallbackHour: string) {
  if (!value) {
    return null
  }

  if (value.dateTime) {
    return new Date(value.dateTime).toISOString()
  }

  if (value.date) {
    return new Date(`${value.date}T${fallbackHour}:00`).toISOString()
  }

  return null
}

function toAllDayEndTimestamp(value: GoogleCalendarEventDateTime | undefined) {
  if (!value?.date) {
    return null
  }

  return new Date(new Date(`${value.date}T00:00:00`).getTime() - 60_000).toISOString()
}

function mapGoogleEventToScheduleEvent(
  item: GoogleCalendarEventItem,
  googleCalendarId: string,
  userId: string,
): ScheduleEvent | null {
  if (item.status === "cancelled") {
    return null
  }

  const start = toEventTimestamp(item.start, "00:00")
  const isAllDay = Boolean(item.start?.date && !item.start?.dateTime)
  const end = isAllDay ? toAllDayEndTimestamp(item.end) : toEventTimestamp(item.end, "23:59")

  if (!start || !end) {
    return null
  }

  const privateProperties = item.extendedProperties?.private
  const isJarvisTaskEvent = privateProperties?.source === "jarvis_task"

  return {
    id: crypto.randomUUID(),
    userId,
    taskId: isJarvisTaskEvent ? privateProperties?.jarvisTaskId || null : null,
    title: item.summary?.trim() || "Untitled event",
    start,
    end,
    source: isJarvisTaskEvent ? "task" : "calendar",
    priority: "medium",
    status: isJarvisTaskEvent ? "scheduled" : null,
    location: item.location?.trim() || null,
    externalEventId: `${googleCalendarId}:${item.id}`,
    gcalEventId: `${googleCalendarId}:${item.id}`,
    lastSyncedFrom: "gcal",
    isImmutable: !isJarvisTaskEvent,
    isCheckedIn: true,
    allDay: isAllDay,
    calendarId: isJarvisTaskEvent ? TASKS_CALENDAR_ID : toCalendarKey(googleCalendarId),
    planId: null,
  }
}

async function fetchGoogleCalendarList(accessToken: string) {
  const response = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new Error(errorText || `Google calendar list failed with status ${response.status}.`)
  }

  const payload = (await response.json()) as GoogleCalendarListResponse
  return (payload.items || []).filter((calendar) => typeof calendar.id === "string" && calendar.id.length > 0)
}

async function fetchGoogleEventsForCalendar(accessToken: string, googleCalendarId: string, userId: string) {
  const now = Date.now()
  const timeMin = new Date(now - GOOGLE_EVENT_LOOKBACK_DAYS * DAY_IN_MS).toISOString()
  const timeMax = new Date(now + GOOGLE_EVENT_LOOKAHEAD_DAYS * DAY_IN_MS).toISOString()
  const searchParams = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "2500",
  })

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(googleCalendarId)}/events?${searchParams.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    },
  )

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new Error(errorText || `Google calendar events failed with status ${response.status}.`)
  }

  const payload = (await response.json()) as GoogleCalendarEventsResponse
  return (payload.items || [])
    .map((item) => mapGoogleEventToScheduleEvent(item, googleCalendarId, userId))
    .filter((event): event is ScheduleEvent => event !== null)
}

export async function loadMirroredGoogleCalendarEventsForUser(userId: string) {
  const adminClient = createSupabaseAdminClient()
  const { data, error } = await adminClient
    .from("schedule_events")
    .select(SCHEDULE_EVENT_SELECT)
    .eq("user_id", userId)
    .eq("last_synced_from", "gcal")
    .order("starts_at", { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((row) => mapScheduleEventRowToScheduleEvent(row as ScheduleEventRow))
}

async function listMirroredGoogleCalendarsForUser(userId: string): Promise<UserCalendar[]> {
  const adminClient = createSupabaseAdminClient()
  const { data, error } = await adminClient
    .from("calendars")
    .select(USER_CALENDAR_SELECT)
    .eq("user_id", userId)
    .eq("source", "google")
    .order("name", { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((row) => mapUserCalendarRowToUserCalendar(row as UserCalendarRow))
}

async function persistGoogleCalendars(userId: string, calendars: GoogleCalendarListItem[]) {
  if (calendars.length === 0) {
    return
  }

  const adminClient = createSupabaseAdminClient()
  const rows = calendars
    .filter((calendar): calendar is GoogleCalendarListItem & { id: string } => typeof calendar.id === "string")
    .map((calendar) => {
      const summary = calendar.summary?.trim() || "Google Calendar"
      return {
        user_id: userId,
        calendar_key: toCalendarKey(calendar.id),
        name: summary,
        color: calendar.backgroundColor?.trim() || "#93c5fd",
        source: "google" as const,
        google_calendar_id: calendar.id,
        remote_name: summary,
        is_visible: true,
        is_immutable: true,
        sync_preference: "active" as const,
        is_task_calendar: false,
        updated_at: new Date().toISOString(),
      }
    })

  const { error } = await adminClient
    .from("calendars")
    .upsert(rows, { onConflict: "user_id,calendar_key" })

  if (error) {
    throw new Error(error.message)
  }
}

async function persistGoogleEvents(userId: string, events: ScheduleEvent[]) {
  const adminClient = createSupabaseAdminClient()

  if (events.length === 0) {
    return
  }

  const { data: existingEvents, error: existingEventsError } = await adminClient
    .from("schedule_events")
    .select("gcal_event_id, priority, is_immutable")
    .eq("user_id", userId)
    .not("gcal_event_id", "is", null)

  if (existingEventsError) {
    throw new Error(existingEventsError.message)
  }

  const existingByGcalId = new Map(
    (existingEvents ?? [])
      .filter((event): event is { gcal_event_id: string; priority: ScheduleEvent["priority"]; is_immutable: boolean } =>
        typeof event.gcal_event_id === "string",
      )
      .map((event) => [event.gcal_event_id, event]),
  )

  const { error } = await adminClient
    .from("schedule_events")
    .upsert(
      events.map((event) => {
        const existing = event.gcalEventId ? existingByGcalId.get(event.gcalEventId) : null

        return mapScheduleEventToInsert(
          {
            ...event,
            priority: existing?.priority ?? event.priority,
            isImmutable: existing?.is_immutable ?? event.isImmutable,
            isCheckedIn: true,
          },
          userId,
        )
      }),
      {
        onConflict: "user_id,gcal_event_id",
      },
    )

  if (error) {
    throw new Error(error.message)
  }
}

async function recordGoogleSourceSnapshot(userId: string, eventCount: number, calendarCount: number) {
  const adminClient = createSupabaseAdminClient()
  const { error } = await adminClient.from("source_snapshots").insert({
    user_id: userId,
    source: "google_calendar",
    freshness: "fresh",
    summary: `Imported ${eventCount} Google Calendar events from ${calendarCount} calendars.`,
    payload: {
      eventCount,
      calendarCount,
    },
  })

  if (error) {
    throw new Error(error.message)
  }
}

function splitStoredGoogleEventId(value: string | null) {
  if (!value) {
    return null
  }

  const separatorIndex = value.indexOf(":")

  if (separatorIndex === -1) {
    return null
  }

  return {
    calendarId: value.slice(0, separatorIndex),
    eventId: value.slice(separatorIndex + 1),
  }
}

async function writeTaskEventToGoogle(
  accessToken: string,
  calendarId: string,
  event: ScheduleEvent,
) {
  const existing = splitStoredGoogleEventId(event.gcalEventId)
  const targetCalendarId = existing?.calendarId || calendarId
  const targetEventId = existing?.eventId
  const url = targetEventId
    ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendarId)}/events/${encodeURIComponent(targetEventId)}`
    : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendarId)}/events`
  const response = await fetch(url, {
    method: targetEventId ? "PATCH" : "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary: event.title,
      start: event.allDay
        ? { date: event.start.slice(0, 10) }
        : { dateTime: event.start },
      end: event.allDay
        ? { date: event.end.slice(0, 10) }
        : { dateTime: event.end },
      extendedProperties: {
        private: {
          jarvisEventId: event.id,
          jarvisTaskId: event.taskId ?? "",
          source: "jarvis_task",
        },
      },
    }),
    cache: "no-store",
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new Error(errorText || `Google task event write failed with status ${response.status}.`)
  }

  const payload = (await response.json()) as GoogleCalendarWriteResponse

  if (!payload.id) {
    throw new Error("Google task event write returned no event id.")
  }

  return {
    calendarId: targetCalendarId,
    eventId: payload.id,
  }
}

export async function syncTaskEventsToGoogleForUser(userId: string) {
  const accessToken = await getValidGoogleAccessToken(userId)

  if (!accessToken) {
    return {
      connected: false,
      synced: 0,
      error: "Google Calendar is not connected or needs reauthorization.",
    }
  }

  const integration = await getStoredGoogleIntegration(userId)
  const targetCalendarId = integration?.selected_calendar_id || "primary"
  const adminClient = createSupabaseAdminClient()
  const { data, error } = await adminClient
    .from("schedule_events")
    .select(SCHEDULE_EVENT_SELECT)
    .eq("user_id", userId)
    .eq("source", "task")
    .eq("status", "scheduled")
    .gte("ends_at", new Date().toISOString())
    .order("starts_at", { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  const taskEvents = (data ?? []).map((row) => mapScheduleEventRowToScheduleEvent(row as ScheduleEventRow))
  let synced = 0

  for (const event of taskEvents) {
    const written = await writeTaskEventToGoogle(accessToken, targetCalendarId, event)
    const storedGcalEventId = `${written.calendarId}:${written.eventId}`
    const { error: updateError } = await adminClient
      .from("schedule_events")
      .update({
        gcal_event_id: storedGcalEventId,
        external_event_id: storedGcalEventId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", event.id)
      .eq("user_id", userId)

    if (updateError) {
      throw new Error(updateError.message)
    }

    synced += 1
  }

  if (!integration?.selected_calendar_id) {
    const { error: integrationError } = await adminClient
      .from("integrations")
      .update({
        selected_calendar_id: targetCalendarId,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("provider", "google")

    if (integrationError) {
      throw new Error(integrationError.message)
    }
  }

  if (synced > 0) {
    const { error: snapshotError } = await adminClient.from("source_snapshots").insert({
      user_id: userId,
      source: "google_calendar",
      freshness: "fresh",
      summary: `Synced ${synced} JARVIS task blocks to Google Calendar.`,
      payload: {
        synced,
        targetCalendarId,
      },
    })

    if (snapshotError) {
      throw new Error(snapshotError.message)
    }
  }

  return {
    connected: true,
    synced,
  }
}

export async function getGoogleCalendarMirrorForUser(userId: string): Promise<GoogleCalendarSyncResponse> {
  const [integration, events, calendars] = await Promise.all([
    getStoredGoogleIntegration(userId),
    loadMirroredGoogleCalendarEventsForUser(userId),
    listMirroredGoogleCalendarsForUser(userId),
  ])
  const needsAuthorization = !integration || integration.status === "needs_reauth"

  return {
    success: true,
    connected: integration?.status === "connected",
    needsAuthorization,
    events,
    calendars,
    error: needsAuthorization ? "Google Calendar needs reauthorization." : undefined,
  }
}

export async function syncGoogleCalendarEventsForUser(userId: string): Promise<GoogleCalendarSyncResponse> {
  const accessToken = await getValidGoogleAccessToken(userId)

  if (!accessToken) {
    const mirror = await getGoogleCalendarMirrorForUser(userId)
    return {
      ...mirror,
      success: false,
      connected: false,
      needsAuthorization: true,
      error: "Google Calendar is not connected or needs reauthorization.",
    }
  }

  try {
    const calendars = await fetchGoogleCalendarList(accessToken)
    await persistGoogleCalendars(userId, calendars)

    const eventResults = await Promise.allSettled(
      calendars.map((calendar) => fetchGoogleEventsForCalendar(accessToken, calendar.id as string, userId)),
    )
    const failedResults = eventResults.filter((result): result is PromiseRejectedResult => result.status === "rejected")

    if (failedResults.length > 0) {
      const firstReason = failedResults[0].reason
      const detail = firstReason instanceof Error ? firstReason.message : String(firstReason)
      throw new Error(`Failed to import ${failedResults.length} Google Calendar(s). ${detail}`)
    }

    const events = eventResults
      .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
      .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime())

    await recordGoogleCalendarTaskFeedback(userId, events)
    await persistGoogleEvents(userId, events)
    await recordGoogleSourceSnapshot(userId, events.length, calendars.length)
    await updateGoogleLastSyncedAt(userId)

    const [mirroredEvents, mirroredCalendars] = await Promise.all([
      loadMirroredGoogleCalendarEventsForUser(userId),
      listMirroredGoogleCalendarsForUser(userId),
    ])

    return {
      success: true,
      connected: true,
      events: mirroredEvents,
      calendars: mirroredCalendars,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Calendar sync failed."
    const needsAuthorization = isGoogleAuthorizationFailure(message)
    await markGoogleIntegrationStatus(userId, needsAuthorization ? "needs_reauth" : "error", message)
    const mirror = await getGoogleCalendarMirrorForUser(userId)
    return {
      ...mirror,
      success: false,
      connected: false,
      needsAuthorization,
      error: message,
    }
  }
}
