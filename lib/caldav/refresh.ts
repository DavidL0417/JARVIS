import { createHash } from "node:crypto"

import { DAVClient } from "tsdav"

import {
  mapScheduleEventRowToScheduleEvent,
  mapScheduleEventToInsert,
  mapUserCalendarRowToUserCalendar,
  SCHEDULE_EVENT_SELECT,
  USER_CALENDAR_SELECT,
} from "@/lib/data/mappers"
import {
  getStoredCalDavIntegration,
  markCalDavIntegrationStatus,
  updateCalDavLastSyncedAt,
} from "@/lib/supabase/caldav-integration"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { parseCalDavEventsFromIcs, toCalDavScheduleEvent } from "@/lib/caldav/events"
import { parseCalDavTodosFromIcs, toCalDavTaskInsert } from "@/lib/caldav/todos"
import { normalizeHexColor } from "@/lib/color"
import { pruneExpiredMirroredEvents } from "@/lib/supabase/schedule-events"
import { loadUserTimezone } from "@/lib/data/user-timezone"
import type {
  Priority,
  ScheduleEvent,
  ScheduleEventRow,
  TaskInsertRow,
  TaskStatus,
  UserCalendar,
  UserCalendarRow,
} from "@/types"

const DAY_IN_MS = 24 * 60 * 60 * 1000
const CALDAV_EVENT_LOOKBACK_DAYS = 90
const CALDAV_EVENT_LOOKAHEAD_DAYS = 180
const CALDAV_CALENDAR_ID_PREFIX = "caldav-calendar:"
const AUTH_ERROR_PATTERN =
  /authorization|authentication|unauthorized|forbidden|invalid credentials|status 401|status 403/i

interface CalDavCalendar {
  url: string
  displayName?: string | Record<string, unknown>
  calendarColor?: string
  components?: string[]
}

// Apple advertises each collection's supported component set. Reminder lists are
// VTODO-only and should not surface as calendars (they inflate the calendar list vs
// what Apple Calendar shows). Keep anything that supports VEVENT, and treat a missing
// component set as "include" so servers that omit it don't lose their calendars.
function supportsCalendarEvents(calendar: CalDavCalendar): boolean {
  const components = calendar.components
  if (!components || components.length === 0) return true
  return components.some((component) => component.toUpperCase() === "VEVENT")
}

// Apple Reminders live in VTODO collections on the same iCloud account. Only treat
// a collection as a reminder list when it explicitly advertises VTODO — unlike the
// event filter, a missing component set is *not* assumed to be a reminder list, so
// ordinary calendars are never double-fetched for todos.
function supportsTodos(calendar: CalDavCalendar): boolean {
  const components = calendar.components
  if (!components || components.length === 0) return false
  return components.some((component) => component.toUpperCase() === "VTODO")
}

interface CalDavCalendarObject {
  data?: unknown
  url: string
}

export interface CalDavSyncResponse {
  success: boolean
  connected: boolean
  needsAuthorization: boolean
  events: ScheduleEvent[]
  calendars: UserCalendar[]
  reminderCount?: number
  error?: string
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24)
}

function toCalendarKey(calendarUrl: string) {
  return `${CALDAV_CALENDAR_ID_PREFIX}${hashValue(calendarUrl)}`
}

function toExternalEventId(input: {
  calendarUrl: string
  objectUrl: string
  uid: string
  recurrenceKey: string | null
}) {
  return [
    "caldav",
    hashValue(input.calendarUrl),
    hashValue(input.objectUrl),
    hashValue(input.uid),
    input.recurrenceKey ? hashValue(input.recurrenceKey) : "single",
  ].join(":")
}

// Mirror toExternalEventId's shape so the reminder-list hash sits at a known index
// (split(":")[1]) — reconciliation reads it back to scope deletes per list.
const CALDAV_TODO_ID_PREFIX = "caldav-todo"

// tsdav's fetchCalendarObjects defaults its calendar-query filter to VEVENT, so a
// VTODO collection returns zero objects unless we ask for VTODO explicitly. (We
// also drop the timeRange: reminders are frequently undated.)
const VTODO_QUERY_FILTERS = [
  {
    "comp-filter": {
      _attributes: { name: "VCALENDAR" },
      "comp-filter": { _attributes: { name: "VTODO" } },
    },
  },
]

function toExternalTaskId(input: { calendarUrl: string; objectUrl: string; uid: string }) {
  return [
    CALDAV_TODO_ID_PREFIX,
    hashValue(input.calendarUrl),
    hashValue(input.objectUrl),
    hashValue(input.uid),
  ].join(":")
}

function listHashFromExternalTaskId(externalTaskId: string): string | null {
  const parts = externalTaskId.split(":")
  return parts[0] === CALDAV_TODO_ID_PREFIX && parts[1] ? parts[1] : null
}

function normalizeCalendarName(value: CalDavCalendar["displayName"]) {
  if (typeof value === "string" && value.trim()) {
    return value.trim()
  }

  return "CalDAV Calendar"
}

function normalizeServerUrl(value: string) {
  return new URL(value).toString()
}

function createCalDavClient(input: {
  serverUrl: string
  username: string
  password: string
}) {
  return new DAVClient({
    serverUrl: normalizeServerUrl(input.serverUrl),
    credentials: {
      username: input.username,
      password: input.password,
    },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  })
}

export async function fetchCalDavCalendars(input: {
  serverUrl: string
  username: string
  password: string
}) {
  const client = createCalDavClient(input)
  await client.login()
  return (await client.fetchCalendars()) as CalDavCalendar[]
}

export async function verifyCalDavConnection(input: {
  serverUrl: string
  username: string
  password: string
}) {
  const calendars = await fetchCalDavCalendars(input)

  if (calendars.length === 0) {
    throw new Error("CalDAV connected, but no calendars were returned.")
  }

  return calendars
}

async function loadIgnoredCalDavCalendarKeys(userId: string): Promise<Set<string>> {
  const adminClient = createSupabaseAdminClient()
  const { data, error } = await adminClient
    .from("calendars")
    .select("calendar_key, sync_preference")
    .eq("user_id", userId)
    .eq("source", "caldav")
    .eq("sync_preference", "ignored")

  if (error) {
    throw new Error(error.message)
  }

  return new Set(
    (data ?? [])
      .map((row) => (row as { calendar_key: string | null }).calendar_key)
      .filter((key): key is string => typeof key === "string" && key.length > 0),
  )
}

async function deleteMirroredCalDavEventsForCalendars(userId: string, calendarKeys: string[]) {
  if (calendarKeys.length === 0) {
    return
  }

  const adminClient = createSupabaseAdminClient()
  const { error } = await adminClient
    .from("schedule_events")
    .delete()
    .eq("user_id", userId)
    .eq("last_synced_from", "caldav")
    .in("calendar_id", calendarKeys)

  if (error) {
    throw new Error(error.message)
  }
}

async function reconcileRemovedCalDavCalendars(userId: string, liveCalendarKeys: string[]) {
  // Drop any persisted CalDAV calendar whose collection is no longer a real event
  // calendar (e.g. reminder lists that were previously ingested before the VEVENT
  // filter, or calendars deleted upstream). Guard on a non-empty live set so a
  // transient empty fetch can never wipe every calendar.
  if (liveCalendarKeys.length === 0) {
    return
  }

  const adminClient = createSupabaseAdminClient()
  const { data, error } = await adminClient
    .from("calendars")
    .select("calendar_key")
    .eq("user_id", userId)
    .eq("source", "caldav")

  if (error) {
    throw new Error(error.message)
  }

  const liveSet = new Set(liveCalendarKeys)
  const staleKeys = (data ?? [])
    .map((row) => (row as { calendar_key: string | null }).calendar_key)
    .filter((key): key is string => typeof key === "string" && key.length > 0 && !liveSet.has(key))

  if (staleKeys.length === 0) {
    return
  }

  // Delete mirrored events first — the schedule view renders events whose calendar is
  // unknown as always-visible, so an orphaned event would become an unhideable zombie.
  await deleteMirroredCalDavEventsForCalendars(userId, staleKeys)

  const { error: deleteError } = await adminClient
    .from("calendars")
    .delete()
    .eq("user_id", userId)
    .eq("source", "caldav")
    .in("calendar_key", staleKeys)

  if (deleteError) {
    throw new Error(deleteError.message)
  }
}

async function listMirroredCalDavCalendarsForUser(userId: string): Promise<UserCalendar[]> {
  const adminClient = createSupabaseAdminClient()
  const { data, error } = await adminClient
    .from("calendars")
    .select(USER_CALENDAR_SELECT)
    .eq("user_id", userId)
    .eq("source", "caldav")
    .order("name", { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((row) => mapUserCalendarRowToUserCalendar(row as UserCalendarRow))
}

async function loadMirroredCalDavEventsForUser(userId: string) {
  const adminClient = createSupabaseAdminClient()
  const { data, error } = await adminClient
    .from("schedule_events")
    .select(SCHEDULE_EVENT_SELECT)
    .eq("user_id", userId)
    .eq("last_synced_from", "caldav")
    .order("starts_at", { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((row) => mapScheduleEventRowToScheduleEvent(row as ScheduleEventRow))
}

async function persistCalDavCalendars(userId: string, calendars: CalDavCalendar[]) {
  if (calendars.length === 0) {
    return
  }

  const adminClient = createSupabaseAdminClient()
  const calendarKeys = calendars.map((calendar) => toCalendarKey(calendar.url))
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

  const rows = calendars.map((calendar) => {
    const calendarKey = toCalendarKey(calendar.url)
    const existing = existingByKey.get(calendarKey)
    const name = normalizeCalendarName(calendar.displayName)

    return {
      user_id: userId,
      calendar_key: calendarKey,
      name,
      color: existing?.color || normalizeHexColor(calendar.calendarColor) || "#7ea69a",
      source: "caldav" as const,
      google_calendar_id: null,
      remote_name: name,
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

async function persistCalDavEvents(userId: string, events: ScheduleEvent[]) {
  if (events.length === 0) {
    return
  }

  const adminClient = createSupabaseAdminClient()
  const { data: existingEvents, error: existingEventsError } = await adminClient
    .from("schedule_events")
    .select("external_event_id, priority, is_immutable")
    .eq("user_id", userId)
    .not("external_event_id", "is", null)

  if (existingEventsError) {
    throw new Error(existingEventsError.message)
  }

  const existingByExternalId = new Map(
    (existingEvents ?? [])
      .filter((event): event is { external_event_id: string; priority: ScheduleEvent["priority"]; is_immutable: boolean } =>
        typeof event.external_event_id === "string",
      )
      .map((event) => [event.external_event_id, event]),
  )

  const { error } = await adminClient
    .from("schedule_events")
    .upsert(
      events.map((event) => {
        const existing = event.externalEventId ? existingByExternalId.get(event.externalEventId) : null

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
        onConflict: "user_id,external_event_id",
      },
    )

  if (error) {
    throw new Error(error.message)
  }
}

interface ExistingMirroredTask {
  external_task_id: string
  status: TaskStatus
  scheduled_for: string | null
  plan_id: string | null
  priority: Priority
  duration_minutes: number | null
}

async function persistCalDavTasks(userId: string, incoming: TaskInsertRow[]) {
  if (incoming.length === 0) {
    return
  }

  const adminClient = createSupabaseAdminClient()
  const externalIds = incoming
    .map((task) => task.external_task_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)

  const { data: existingTasks, error: existingTasksError } = await adminClient
    .from("tasks")
    .select("external_task_id, status, scheduled_for, plan_id, priority, duration_minutes")
    .eq("user_id", userId)
    .eq("last_synced_from", "caldav")
    .in("external_task_id", externalIds)

  if (existingTasksError) {
    throw new Error(existingTasksError.message)
  }

  const existingByExternalId = new Map(
    (existingTasks ?? [])
      .filter((task): task is ExistingMirroredTask => typeof task.external_task_id === "string")
      .map((task) => [task.external_task_id, task]),
  )

  const rows = incoming.map((row) => {
    const existing = row.external_task_id ? existingByExternalId.get(row.external_task_id) : null
    if (!existing) {
      return row
    }

    // Preserve planner-owned fields so a re-sync never clobbers scheduling the
    // user (or the planner) applied locally. Only the reminder-derived fields
    // (title, deadline, description, all_day) are refreshed from the phone.
    return {
      ...row,
      status: existing.status,
      scheduled_for: existing.scheduled_for,
      plan_id: existing.plan_id,
      priority: existing.priority,
      duration_minutes: existing.duration_minutes,
    }
  })

  const { error } = await adminClient
    .from("tasks")
    .upsert(rows, { onConflict: "user_id,external_task_id" })

  if (error) {
    throw new Error(error.message)
  }
}

async function reconcileRemovedCalDavTasks(
  userId: string,
  succeededListHashes: Set<string>,
  liveExternalTaskIds: Set<string>,
) {
  // Only reconcile lists we actually fetched this run — a list that errored is
  // left untouched so a transient failure can't wipe its mirrored tasks.
  if (succeededListHashes.size === 0) {
    return
  }

  const adminClient = createSupabaseAdminClient()
  const { data, error } = await adminClient
    .from("tasks")
    .select("id, external_task_id")
    .eq("user_id", userId)
    .eq("last_synced_from", "caldav")

  if (error) {
    throw new Error(error.message)
  }

  const staleIds = (data ?? [])
    .filter((row) => {
      const externalTaskId = (row as { external_task_id: string | null }).external_task_id
      if (typeof externalTaskId !== "string") {
        return false
      }
      const listHash = listHashFromExternalTaskId(externalTaskId)
      return Boolean(listHash && succeededListHashes.has(listHash) && !liveExternalTaskIds.has(externalTaskId))
    })
    .map((row) => (row as { id: string }).id)

  if (staleIds.length === 0) {
    return
  }

  // Drop any planner-created schedule blocks first: the task FK is on-delete-set-null,
  // so an orphaned block would otherwise linger on the grid as an untitled ghost.
  const { error: scheduleError } = await adminClient
    .from("schedule_events")
    .delete()
    .eq("user_id", userId)
    .in("task_id", staleIds)

  if (scheduleError) {
    throw new Error(scheduleError.message)
  }

  const { error: deleteError } = await adminClient.from("tasks").delete().eq("user_id", userId).in("id", staleIds)

  if (deleteError) {
    throw new Error(deleteError.message)
  }
}

async function recordCalDavSourceSnapshot(
  userId: string,
  eventCount: number,
  calendarCount: number,
  failedCount = 0,
  reminderCount = 0,
) {
  const adminClient = createSupabaseAdminClient()
  const failureNote = failedCount > 0 ? ` ${failedCount} calendar(s) failed to import.` : ""
  const reminderNote = reminderCount > 0 ? ` Mirrored ${reminderCount} reminder(s).` : ""
  const { error } = await adminClient.from("source_snapshots").insert({
    user_id: userId,
    source: "caldav",
    freshness: "fresh",
    summary: `Imported ${eventCount} CalDAV events from ${calendarCount} calendars.${reminderNote}${failureNote}`,
    payload: {
      eventCount,
      calendarCount,
      failedCount,
      reminderCount,
    },
  })

  if (error) {
    throw new Error(error.message)
  }
}

export async function getCalDavMirrorForUser(userId: string): Promise<CalDavSyncResponse> {
  const [integration, events, calendars] = await Promise.all([
    getStoredCalDavIntegration(userId),
    loadMirroredCalDavEventsForUser(userId),
    listMirroredCalDavCalendarsForUser(userId),
  ])
  const needsAuthorization = !integration || integration.status === "needs_reauth"

  return {
    success: true,
    connected: integration?.status === "connected",
    needsAuthorization,
    events,
    calendars,
    error: needsAuthorization ? "CalDAV needs connection details." : undefined,
  }
}

export async function refreshCalDavForUser(userId: string): Promise<CalDavSyncResponse> {
  const integration = await getStoredCalDavIntegration(userId)

  if (!integration?.server_url || !integration.provider_account_email || !integration.password) {
    const mirror = await getCalDavMirrorForUser(userId)
    return {
      ...mirror,
      success: false,
      connected: false,
      needsAuthorization: true,
      error: "CalDAV is not connected with account credentials.",
    }
  }

  try {
    const client = createCalDavClient({
      serverUrl: integration.server_url,
      username: integration.provider_account_email,
      password: integration.password,
    })
    await client.login()

    const rangeStart = new Date(Date.now() - CALDAV_EVENT_LOOKBACK_DAYS * DAY_IN_MS)
    const rangeEnd = new Date(Date.now() + CALDAV_EVENT_LOOKAHEAD_DAYS * DAY_IN_MS)
    const timeZone = await loadUserTimezone(userId)
    const fetchedCalendars = (await client.fetchCalendars()) as CalDavCalendar[]
    // Reminder lists (VTODO-only) are not event calendars — exclude them so Jarvis's
    // calendar list matches what Apple Calendar shows.
    const calendars = fetchedCalendars.filter(supportsCalendarEvents)
    await persistCalDavCalendars(userId, calendars)
    await reconcileRemovedCalDavCalendars(
      userId,
      calendars.map((calendar) => toCalendarKey(calendar.url)),
    )

    // Respect per-calendar sync preference: skip "ignored" calendars and remove
    // any events previously mirrored from them (CalDAV has no stale reconciler).
    const ignoredCalendarKeys = await loadIgnoredCalDavCalendarKeys(userId)
    await deleteMirroredCalDavEventsForCalendars(userId, [...ignoredCalendarKeys])
    const activeCalendars = calendars.filter((calendar) => !ignoredCalendarKeys.has(toCalendarKey(calendar.url)))

    const eventResults = await Promise.allSettled(
      activeCalendars.map(async (calendar) => {
        const objects = (await client.fetchCalendarObjects({
          calendar,
          timeRange: {
            start: rangeStart.toISOString(),
            end: rangeEnd.toISOString(),
          },
        })) as CalDavCalendarObject[]

        return objects.flatMap((object) => {
          const calendarData = typeof object.data === "string" ? object.data : ""
          const parsedEvents = parseCalDavEventsFromIcs({
            calendarData,
            rangeStart,
            rangeEnd,
            timeZone,
          })

          return parsedEvents.map((parsedEvent) =>
            toCalDavScheduleEvent({
              parsedEvent,
              userId,
              calendarId: toCalendarKey(calendar.url),
              externalEventId: toExternalEventId({
                calendarUrl: calendar.url,
                objectUrl: object.url,
                uid: parsedEvent.uid,
                recurrenceKey: parsedEvent.recurrenceKey,
              }),
            }),
          )
        })
      }),
    )
    const failedResults = eventResults.filter((result): result is PromiseRejectedResult => result.status === "rejected")
    const events = eventResults
      .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
      .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime())

    // Persist whatever succeeded instead of discarding the whole sync when one calendar
    // fails. Only escalate when *every* active calendar failed — and reserve re-auth for
    // the auth-error case so a single shared-calendar 403 can't disable the integration.
    if (activeCalendars.length > 0 && failedResults.length === activeCalendars.length) {
      const firstReason = failedResults[0].reason
      const detail = firstReason instanceof Error ? firstReason.message : String(firstReason)
      throw new Error(
        AUTH_ERROR_PATTERN.test(detail)
          ? detail
          : `Failed to import all ${failedResults.length} CalDAV calendar(s). ${detail}`,
      )
    }

    await persistCalDavEvents(userId, events)
    await pruneExpiredMirroredEvents(createSupabaseAdminClient(), userId)

    // Apple Reminders ride the same iCloud account as VTODO collections. Mirror
    // open reminders one-way into tasks, then reconcile any that were completed or
    // deleted on the phone. Fetched without a time range — todos may be undated.
    const reminderCollections = fetchedCalendars.filter(supportsTodos)
    const reminderResults = await Promise.allSettled(
      reminderCollections.map(async (calendar) => {
        const objects = (await client.fetchCalendarObjects({
          calendar,
          filters: VTODO_QUERY_FILTERS,
        })) as CalDavCalendarObject[]
        const taskInserts = objects.flatMap((object) => {
          const calendarData = typeof object.data === "string" ? object.data : ""
          const parsedTodos = parseCalDavTodosFromIcs({ calendarData, timeZone })

          return parsedTodos.map((parsedTodo) =>
            toCalDavTaskInsert({
              parsedTodo,
              userId,
              externalTaskId: toExternalTaskId({
                calendarUrl: calendar.url,
                objectUrl: object.url,
                uid: parsedTodo.uid,
              }),
            }),
          )
        })

        return { listHash: hashValue(calendar.url), taskInserts }
      }),
    )

    const succeededReminderLists = new Set<string>()
    const liveTaskIds = new Set<string>()
    const reminderTaskInserts: TaskInsertRow[] = []
    for (const result of reminderResults) {
      if (result.status !== "fulfilled") {
        continue
      }
      succeededReminderLists.add(result.value.listHash)
      for (const insert of result.value.taskInserts) {
        reminderTaskInserts.push(insert)
        if (insert.external_task_id) {
          liveTaskIds.add(insert.external_task_id)
        }
      }
    }

    await persistCalDavTasks(userId, reminderTaskInserts)
    await reconcileRemovedCalDavTasks(userId, succeededReminderLists, liveTaskIds)
    const reminderCount = reminderTaskInserts.length

    await recordCalDavSourceSnapshot(
      userId,
      events.length,
      activeCalendars.length,
      failedResults.length,
      reminderCount,
    )
    await updateCalDavLastSyncedAt(userId)

    const [mirroredEvents, mirroredCalendars] = await Promise.all([
      loadMirroredCalDavEventsForUser(userId),
      listMirroredCalDavCalendarsForUser(userId),
    ])

    return {
      success: true,
      connected: true,
      needsAuthorization: false,
      events: mirroredEvents,
      calendars: mirroredCalendars,
      reminderCount,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "CalDAV sync failed."
    const needsAuthorization = AUTH_ERROR_PATTERN.test(message)
    await markCalDavIntegrationStatus({
      userId,
      status: needsAuthorization ? "needs_reauth" : "error",
      summary: message,
    })
    const mirror = await getCalDavMirrorForUser(userId)

    return {
      ...mirror,
      success: false,
      connected: false,
      needsAuthorization,
      error: message,
    }
  }
}
