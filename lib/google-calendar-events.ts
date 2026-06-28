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
import { pruneExpiredMirroredEvents } from "@/lib/supabase/schedule-events"
import { CALENDAR_FEEDBACK_LEARNING_ENABLED, recordGoogleCalendarTaskFeedback } from "@/lib/sources/calendar-feedback"
import { TASKS_CALENDAR_ID } from "@/lib/task-calendar-constants"
import { loadUserTimezone } from "@/lib/data/user-timezone"
import { zonedDateStartUtc } from "@/lib/time/zoned"
import type { GoogleCalendarSyncResponse, ScheduleEvent, ScheduleEventRow, UserCalendar, UserCalendarRow } from "@/types"

const DAY_IN_MS = 24 * 60 * 60 * 1000
const GOOGLE_EVENT_LOOKBACK_DAYS = 90
const GOOGLE_EVENT_LOOKAHEAD_DAYS = 180
const GOOGLE_CALENDAR_ID_PREFIX = "google-calendar:"

interface GoogleCalendarSyncWindow {
  timeMin: string
  timeMax: string
}

interface MirroredGoogleEventRecord {
  id: string
  gcal_event_id: string | null
  calendar_id: string | null
  starts_at: string
  ends_at: string
  source: ScheduleEvent["source"]
  last_synced_from: ScheduleEvent["lastSyncedFrom"]
}

function isGoogleAuthorizationFailure(message: string) {
  return /authorization|reauthorization|unauthorized|invalid authentication|invalid credentials|status 401|not connected/i.test(
    message,
  )
}

interface GoogleCalendarListItem {
  id?: string
  summary?: string
  backgroundColor?: string
  accessRole?: string
  primary?: boolean
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
  htmlLink?: string
}

function toCalendarKey(googleCalendarId: string) {
  return `${GOOGLE_CALENDAR_ID_PREFIX}${googleCalendarId}`
}

function getGoogleCalendarSyncWindow(now = Date.now()): GoogleCalendarSyncWindow {
  return {
    timeMin: new Date(now - GOOGLE_EVENT_LOOKBACK_DAYS * DAY_IN_MS).toISOString(),
    timeMax: new Date(now + GOOGLE_EVENT_LOOKAHEAD_DAYS * DAY_IN_MS).toISOString(),
  }
}

function getStoredGoogleEventCalendarKey(event: Pick<MirroredGoogleEventRecord, "calendar_id" | "gcal_event_id">) {
  if (event.calendar_id?.startsWith(GOOGLE_CALENDAR_ID_PREFIX)) {
    return event.calendar_id
  }

  const parsedEventId = splitStoredGoogleEventId(event.gcal_event_id)
  return parsedEventId ? toCalendarKey(parsedEventId.calendarId) : null
}

function overlapsSyncWindow(
  event: Pick<MirroredGoogleEventRecord, "starts_at" | "ends_at">,
  syncWindow: GoogleCalendarSyncWindow,
) {
  return new Date(event.ends_at).getTime() >= new Date(syncWindow.timeMin).getTime() &&
    new Date(event.starts_at).getTime() <= new Date(syncWindow.timeMax).getTime()
}

export function getStaleGoogleMirrorEventIdsForTest(input: {
  mirroredEvents: MirroredGoogleEventRecord[]
  currentGcalEventIds: Set<string>
  currentCalendarKeys: Set<string>
  syncWindow: GoogleCalendarSyncWindow
}) {
  return input.mirroredEvents
    .filter((event) => {
      if (event.source !== "calendar" || event.last_synced_from !== "gcal" || !event.gcal_event_id) {
        return false
      }

      const calendarKey = getStoredGoogleEventCalendarKey(event)

      if (!calendarKey) {
        return false
      }

      if (!input.currentCalendarKeys.has(calendarKey)) {
        return true
      }

      return overlapsSyncWindow(event, input.syncWindow) && !input.currentGcalEventIds.has(event.gcal_event_id)
    })
    .map((event) => event.id)
}

function toEventTimestamp(value: GoogleCalendarEventDateTime | undefined) {
  if (!value?.dateTime) {
    return null
  }

  return new Date(value.dateTime).toISOString()
}

function toAllDayStartTimestamp(value: GoogleCalendarEventDateTime | undefined, timeZone: string) {
  if (!value?.date) {
    return null
  }

  return zonedDateStartUtc(value.date, timeZone).toISOString()
}

function toAllDayEndTimestamp(value: GoogleCalendarEventDateTime | undefined, timeZone: string) {
  if (!value?.date) {
    return null
  }

  // Google all-day `end.date` is exclusive (the day after the event). Store the
  // event ending one minute before midnight (user timezone) of that exclusive
  // day so the [start, end] interval stays within the user's calendar days.
  return new Date(zonedDateStartUtc(value.date, timeZone).getTime() - 60_000).toISOString()
}

function mapGoogleEventToScheduleEvent(
  item: GoogleCalendarEventItem,
  googleCalendarId: string,
  userId: string,
  timeZone: string,
): ScheduleEvent | null {
  if (item.status === "cancelled") {
    return null
  }

  const isAllDay = Boolean(item.start?.date && !item.start?.dateTime)
  const start = isAllDay ? toAllDayStartTimestamp(item.start, timeZone) : toEventTimestamp(item.start)
  const end = isAllDay ? toAllDayEndTimestamp(item.end, timeZone) : toEventTimestamp(item.end)

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

export function mapGoogleEventToScheduleEventForTest(
  item: GoogleCalendarEventItem,
  googleCalendarId: string,
  userId: string,
  timeZone: string,
) {
  return mapGoogleEventToScheduleEvent(item, googleCalendarId, userId, timeZone)
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

async function fetchGoogleEventsForCalendar(
  accessToken: string,
  googleCalendarId: string,
  userId: string,
  syncWindow: GoogleCalendarSyncWindow,
  timeZone: string,
) {
  const searchParams = new URLSearchParams({
    timeMin: syncWindow.timeMin,
    timeMax: syncWindow.timeMax,
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
    .map((item) => mapGoogleEventToScheduleEvent(item, googleCalendarId, userId, timeZone))
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

async function loadIgnoredGoogleCalendarIds(userId: string): Promise<Set<string>> {
  const adminClient = createSupabaseAdminClient()
  const { data, error } = await adminClient
    .from("calendars")
    .select("google_calendar_id, sync_preference")
    .eq("user_id", userId)
    .eq("source", "google")
    .eq("sync_preference", "ignored")

  if (error) {
    throw new Error(error.message)
  }

  return new Set(
    (data ?? [])
      .map((row) => (row as { google_calendar_id: string | null }).google_calendar_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  )
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
  const calendarKeys = calendars
    .filter((calendar): calendar is GoogleCalendarListItem & { id: string } => typeof calendar.id === "string")
    .map((calendar) => toCalendarKey(calendar.id))

  if (calendarKeys.length === 0) {
    return
  }

  const { data: existingCalendars, error: existingCalendarsError } = await adminClient
    .from("calendars")
    .select(USER_CALENDAR_SELECT)
    .eq("user_id", userId)
    .in("calendar_key", calendarKeys)

  if (existingCalendarsError) {
    throw new Error(existingCalendarsError.message)
  }

  const existingByKey = new Map(
    (existingCalendars ?? []).map((calendar) => [calendar.calendar_key as string, calendar as UserCalendarRow]),
  )

  const rows = calendars
    .filter((calendar): calendar is GoogleCalendarListItem & { id: string } => typeof calendar.id === "string")
    .map((calendar) => {
      const summary = calendar.summary?.trim() || "Google Calendar"
      const calendarKey = toCalendarKey(calendar.id)
      const existing = existingByKey.get(calendarKey)

      return {
        user_id: userId,
        calendar_key: calendarKey,
        name: summary,
        color: existing?.color || calendar.backgroundColor?.trim() || "#93c5fd",
        source: "google" as const,
        google_calendar_id: calendar.id,
        remote_name: summary,
        is_visible: existing?.is_visible ?? true,
        is_immutable: true,
        sync_preference: existing?.sync_preference ?? ("active" as const),
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

async function deleteStaleMirroredGoogleEvents(input: {
  userId: string
  currentEvents: ScheduleEvent[]
  currentCalendarKeys: string[]
  syncWindow: GoogleCalendarSyncWindow
}) {
  const adminClient = createSupabaseAdminClient()
  const { data, error } = await adminClient
    .from("schedule_events")
    .select("id, gcal_event_id, calendar_id, starts_at, ends_at, source, last_synced_from")
    .eq("user_id", input.userId)
    .eq("source", "calendar")
    .eq("last_synced_from", "gcal")
    .not("gcal_event_id", "is", null)

  if (error) {
    throw new Error(error.message)
  }

  const staleIds = getStaleGoogleMirrorEventIdsForTest({
    mirroredEvents: (data ?? []) as MirroredGoogleEventRecord[],
    currentGcalEventIds: new Set(
      input.currentEvents
        .map((event) => event.gcalEventId)
        .filter((eventId): eventId is string => typeof eventId === "string" && eventId.length > 0),
    ),
    currentCalendarKeys: new Set(input.currentCalendarKeys),
    syncWindow: input.syncWindow,
  })

  if (staleIds.length === 0) {
    return 0
  }

  const { error: deleteError } = await adminClient
    .from("schedule_events")
    .delete()
    .eq("user_id", input.userId)
    .in("id", staleIds)

  if (deleteError) {
    throw new Error(deleteError.message)
  }

  return staleIds.length
}

async function persistGoogleEvents(input: {
  userId: string
  events: ScheduleEvent[]
  calendarKeys: string[]
  syncWindow: GoogleCalendarSyncWindow
}) {
  const adminClient = createSupabaseAdminClient()
  const { data: existingEvents, error: existingEventsError } = await adminClient
    .from("schedule_events")
    .select("gcal_event_id, priority, is_immutable")
    .eq("user_id", input.userId)
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

  if (input.events.length > 0) {
    const { error } = await adminClient
      .from("schedule_events")
      .upsert(
        input.events.map((event) => {
          const existing = event.gcalEventId ? existingByGcalId.get(event.gcalEventId) : null

          return mapScheduleEventToInsert(
            {
              ...event,
              priority: existing?.priority ?? event.priority,
              isImmutable: existing?.is_immutable ?? event.isImmutable,
              isCheckedIn: true,
            },
            input.userId,
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

  const removedStaleEventCount = await deleteStaleMirroredGoogleEvents({
    userId: input.userId,
    currentEvents: input.events,
    currentCalendarKeys: input.calendarKeys,
    syncWindow: input.syncWindow,
  })

  return {
    upsertedEventCount: input.events.length,
    removedStaleEventCount,
  }
}

async function recordGoogleSourceSnapshot(
  userId: string,
  eventCount: number,
  calendarCount: number,
  removedStaleEventCount: number,
) {
  const adminClient = createSupabaseAdminClient()
  const removedSummary = removedStaleEventCount > 0
    ? ` Removed ${removedStaleEventCount} stale mirrored event${removedStaleEventCount === 1 ? "" : "s"}.`
    : ""
  const { error } = await adminClient.from("source_snapshots").insert({
    user_id: userId,
    source: "google_calendar",
    freshness: "fresh",
    summary: `Imported ${eventCount} Google Calendar events from ${calendarCount} calendars.${removedSummary}`,
    payload: {
      eventCount,
      calendarCount,
      removedStaleEventCount,
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

// Remove a JARVIS-mirrored task block from Google Calendar. Called when a
// scheduled block is unscheduled or its task deleted, so the block doesn't
// linger on the user's phone calendar (and re-import as a provisional event on
// the next inbound sync). Best-effort: a missing event (404/410) is treated as
// already gone, and a disconnected Google account is a no-op rather than an error.
export async function deleteTaskEventFromGoogle(userId: string, storedGcalEventId: string) {
  const target = splitStoredGoogleEventId(storedGcalEventId)

  if (!target) {
    return { connected: false, deleted: false }
  }

  const accessToken = await getValidGoogleAccessToken(userId)

  if (!accessToken) {
    return { connected: false, deleted: false }
  }

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(target.calendarId)}/events/${encodeURIComponent(target.eventId)}`
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  })

  // 404/410 → the event is already gone on Google's side; nothing to clean up.
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    const errorText = await response.text().catch(() => "")
    throw new Error(errorText || `Google task event delete failed with status ${response.status}.`)
  }

  return { connected: true, deleted: true }
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

export interface CreateGoogleCalendarEventInput {
  title: string
  startIso: string
  endIso: string
  // Name of an EXISTING calendar to target (case-insensitive). Null/omitted writes
  // to the primary calendar. We never create a calendar — that needs a scope JARVIS
  // does not request.
  calendarName?: string | null
  description?: string | null
  location?: string | null
  allDay?: boolean
}

export interface CreateGoogleCalendarEventResult {
  connected: boolean
  created: boolean
  error?: string
  eventId?: string
  htmlLink?: string
  // Friendly name of the calendar the event landed on (for the receipt/summary).
  calendarSummary?: string
  // Populated when a named calendar couldn't be resolved, so the caller can tell
  // the user what they *can* write to.
  availableCalendars?: string[]
}

const WRITABLE_GOOGLE_ACCESS_ROLES = new Set(["owner", "writer"])

// Format a UTC ISO instant to its YYYY-MM-DD calendar date IN the given timezone
// (en-CA yields ISO-style YYYY-MM-DD). Used for all-day event dates so an evening
// local time doesn't roll onto the next UTC day.
function localDateKeyFromIso(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso))
}

// Add days to a YYYY-MM-DD key using pure calendar arithmetic (no timezone math).
function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number)
  const dt = new Date(Date.UTC(year, month - 1, day))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

// calendarList omits accessRole on some reads; when it's absent we only trust the
// primary calendar as writable, otherwise require an explicit owner/writer role.
function isWritableGoogleCalendar(item: GoogleCalendarListItem): boolean {
  if (!item.accessRole) {
    return Boolean(item.primary)
  }
  return WRITABLE_GOOGLE_ACCESS_ROLES.has(item.accessRole)
}

// Create a single arbitrary event on the user's Google Calendar. Unlike
// syncTaskEventsToGoogleForUser (which mirrors JARVIS task blocks), this writes a
// user-authored event the assistant composed. Approval-gated upstream: the agent
// loop queues a pending approval, and the approve route calls this on confirm.
export async function createGoogleCalendarEventForUser(
  userId: string,
  input: CreateGoogleCalendarEventInput,
): Promise<CreateGoogleCalendarEventResult> {
  const accessToken = await getValidGoogleAccessToken(userId)
  if (!accessToken) {
    return {
      connected: false,
      created: false,
      error: "Google Calendar is not connected or needs reauthorization.",
    }
  }

  const title = input.title?.trim()
  if (!title) {
    return { connected: true, created: false, error: "An event title is required." }
  }
  if (!input.startIso || !input.endIso) {
    return { connected: true, created: false, error: "Both a start and end time are required." }
  }

  // Resolve the target calendar. A named calendar is matched case-insensitively
  // against the user's writable calendars; otherwise default to primary. We do not
  // create calendars (no scope for it) — an unmatched name is a hard error.
  let targetCalendarId = "primary"
  let calendarSummary = "your primary calendar"
  const requestedName = input.calendarName?.trim()

  if (requestedName && requestedName.toLowerCase() !== "primary") {
    const calendars = await fetchGoogleCalendarList(accessToken)
    const match = calendars.find(
      (calendar) => (calendar.summary ?? "").trim().toLowerCase() === requestedName.toLowerCase(),
    )

    if (!match || !match.id) {
      const available = calendars
        .filter(isWritableGoogleCalendar)
        .map((calendar) => calendar.summary?.trim())
        .filter((summary): summary is string => Boolean(summary))
      return {
        connected: true,
        created: false,
        error: `No Google calendar named "${requestedName}" was found. JARVIS can add events to an existing calendar but cannot create a new one.`,
        availableCalendars: available,
      }
    }

    if (!isWritableGoogleCalendar(match)) {
      return {
        connected: true,
        created: false,
        error: `The Google calendar "${match.summary ?? requestedName}" is read-only, so events can't be added to it.`,
      }
    }

    targetCalendarId = match.id
    calendarSummary = match.summary?.trim() || requestedName
  }

  const body: Record<string, unknown> = {
    summary: title,
    extendedProperties: {
      private: {
        // Provenance marker for events JARVIS authored. NOT yet consumed by the read
        // path (mapGoogleEventToScheduleEvent only special-cases "jarvis_task"), so
        // these round-trip as ordinary immutable mirrored events by design.
        source: "jarvis_assistant",
      },
    },
  }

  if (input.allDay) {
    // All-day dates must be the user's LOCAL calendar date, not a slice of the UTC
    // instant (an evening local time rolls to the next UTC day). Google's all-day
    // end.date is EXCLUSIVE — it must be the day AFTER the last day — so a single-day
    // event needs end = start + 1 day (matching the exclusivity the read path handles).
    const timezone = await loadUserTimezone(userId)
    const startDateKey = localDateKeyFromIso(input.startIso, timezone)
    let lastDayKey = localDateKeyFromIso(input.endIso, timezone)
    if (lastDayKey < startDateKey) {
      lastDayKey = startDateKey
    }
    body.start = { date: startDateKey }
    body.end = { date: addDaysToDateKey(lastDayKey, 1) }
  } else {
    body.start = { dateTime: input.startIso }
    body.end = { dateTime: input.endIso }
  }
  if (input.description?.trim()) {
    body.description = input.description.trim()
  }
  if (input.location?.trim()) {
    body.location = input.location.trim()
  }

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    },
  )

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    return {
      connected: true,
      created: false,
      error: errorText || `Google Calendar event create failed with status ${response.status}.`,
    }
  }

  const payload = (await response.json()) as GoogleCalendarWriteResponse
  if (!payload.id) {
    return { connected: true, created: false, error: "Google Calendar returned no event id." }
  }

  return {
    connected: true,
    created: true,
    eventId: payload.id,
    htmlLink: payload.htmlLink,
    calendarSummary,
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
    const syncWindow = getGoogleCalendarSyncWindow()
    const timeZone = await loadUserTimezone(userId)
    const calendars = await fetchGoogleCalendarList(accessToken)
    await persistGoogleCalendars(userId, calendars)

    // Respect per-calendar sync preference: calendars marked "ignored" are not
    // fetched, and dropping them from calendarKeys lets the stale-event cleanup
    // remove any events previously mirrored from them.
    const ignoredGoogleCalendarIds = await loadIgnoredGoogleCalendarIds(userId)
    const activeCalendars = calendars.filter(
      (calendar): calendar is GoogleCalendarListItem & { id: string } =>
        typeof calendar.id === "string" && !ignoredGoogleCalendarIds.has(calendar.id),
    )
    const calendarKeys = activeCalendars.map((calendar) => toCalendarKey(calendar.id))

    const eventResults = await Promise.allSettled(
      activeCalendars.map((calendar) =>
        fetchGoogleEventsForCalendar(accessToken, calendar.id, userId, syncWindow, timeZone),
      ),
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

    if (CALENDAR_FEEDBACK_LEARNING_ENABLED) {
      await recordGoogleCalendarTaskFeedback(userId, events)
    }
    const persistenceResult = await persistGoogleEvents({
      userId,
      events,
      calendarKeys,
      syncWindow,
    })
    await pruneExpiredMirroredEvents(createSupabaseAdminClient(), userId)
    await recordGoogleSourceSnapshot(userId, events.length, calendars.length, persistenceResult.removedStaleEventCount)
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
