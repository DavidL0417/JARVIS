// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { google, type calendar_v3 } from "googleapis"

import type { GoogleCalendarExtendedProperties, Priority, ScheduleEvent, SyncOrigin } from "@/types"

const JARVIS_EXTENDED_PROPERTY_KEYS = {
  priority: "jarvis_priority",
  isImmutable: "jarvis_is_immutable",
  isCheckedIn: "jarvis_is_checked_in",
  lastSyncedFrom: "jarvis_last_synced_from",
  taskId: "jarvis_task_id",
  localEventId: "jarvis_local_event_id",
} as const

type GoogleEventPrivateProperties = NonNullable<
  NonNullable<calendar_v3.Schema$Event["extendedProperties"]>["private"]
>

export function getGoogleOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri) {
    return null
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

function serializeBoolean(value: boolean) {
  return value ? "true" : "false"
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === "true") {
    return true
  }

  if (value === "false") {
    return false
  }

  return fallback
}

function normalizePriority(value: string | undefined): Priority {
  if (value === "low" || value === "high") {
    return value
  }

  return "medium"
}

function normalizeSyncOrigin(value: string | undefined): SyncOrigin {
  if (value === "gcal") {
    return value
  }

  return "local"
}

function toGoogleAllDayEndDate(end: string) {
  const exclusiveEnd = new Date(end)
  exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1)
  return exclusiveEnd.toISOString().slice(0, 10)
}

export function buildJarvisExtendedProperties(
  event: Pick<
    ScheduleEvent,
    "id" | "taskId" | "priority" | "isImmutable" | "isCheckedIn" | "lastSyncedFrom"
  >,
): calendar_v3.Schema$Event["extendedProperties"] {
  const privateProperties: GoogleEventPrivateProperties = {
    [JARVIS_EXTENDED_PROPERTY_KEYS.priority]: event.priority,
    [JARVIS_EXTENDED_PROPERTY_KEYS.isImmutable]: serializeBoolean(event.isImmutable),
    [JARVIS_EXTENDED_PROPERTY_KEYS.isCheckedIn]: serializeBoolean(event.isCheckedIn),
    [JARVIS_EXTENDED_PROPERTY_KEYS.lastSyncedFrom]: event.lastSyncedFrom,
    [JARVIS_EXTENDED_PROPERTY_KEYS.localEventId]: event.id,
  }

  if (event.taskId) {
    privateProperties[JARVIS_EXTENDED_PROPERTY_KEYS.taskId] = event.taskId
  }

  return {
    private: privateProperties,
  }
}

export function readJarvisExtendedProperties(
  event: Pick<calendar_v3.Schema$Event, "extendedProperties">,
): GoogleCalendarExtendedProperties | null {
  const privateProperties = event.extendedProperties?.private

  if (!privateProperties) {
    return null
  }

  return {
    priority: normalizePriority(privateProperties[JARVIS_EXTENDED_PROPERTY_KEYS.priority]),
    isImmutable: parseBoolean(
      privateProperties[JARVIS_EXTENDED_PROPERTY_KEYS.isImmutable],
      false,
    ),
    isCheckedIn: parseBoolean(
      privateProperties[JARVIS_EXTENDED_PROPERTY_KEYS.isCheckedIn],
      false,
    ),
    lastSyncedFrom: normalizeSyncOrigin(
      privateProperties[JARVIS_EXTENDED_PROPERTY_KEYS.lastSyncedFrom],
    ),
    taskId: privateProperties[JARVIS_EXTENDED_PROPERTY_KEYS.taskId] ?? null,
    localEventId: privateProperties[JARVIS_EXTENDED_PROPERTY_KEYS.localEventId] ?? null,
  }
}

export function buildGoogleCalendarEventPayload(
  event: Pick<
    ScheduleEvent,
    | "id"
    | "title"
    | "start"
    | "end"
    | "location"
    | "allDay"
    | "taskId"
    | "priority"
    | "isImmutable"
    | "isCheckedIn"
    | "lastSyncedFrom"
  >,
): calendar_v3.Schema$Event {
  return {
    summary: event.title,
    location: event.location ?? undefined,
    start: event.allDay
      ? { date: event.start.slice(0, 10) }
      : { dateTime: event.start },
    end: event.allDay
      ? { date: toGoogleAllDayEndDate(event.end) }
      : { dateTime: event.end },
    extendedProperties: buildJarvisExtendedProperties(event),
  }
}

export function buildScheduleEventPatchFromGoogleEvent(
  event: Pick<
    calendar_v3.Schema$Event,
    "id" | "summary" | "location" | "start" | "end" | "extendedProperties"
  >,
) {
  const metadata = readJarvisExtendedProperties(event)

  return {
    title: event.summary?.trim() || "Untitled event",
    location: event.location?.trim() || null,
    gcalEventId: event.id ?? null,
    priority: metadata?.priority ?? "medium",
    isImmutable: metadata?.isImmutable ?? false,
    isCheckedIn: metadata?.isCheckedIn ?? false,
    lastSyncedFrom: "gcal" as const,
    taskId: metadata?.taskId ?? null,
  }
}

export async function createCalendarEvents(events: ScheduleEvent[]) {
  const authClient = getGoogleOAuthClient()

  void authClient

  // Intentional architecture rule:
  // Google Calendar is mirrored into Supabase first, and the frontend reads Supabase.
  // This sync layer only speaks Google Calendar Events, never Google Tasks API.
  return {
    success: true,
    createdCount: events.length,
    externalEventIds: [] as string[],
    payloads: events.map(buildGoogleCalendarEventPayload),
  }
}

export async function updateCalendarEvents(events: ScheduleEvent[]) {
  const authClient = getGoogleOAuthClient()

  void authClient

  // TODO: Diff and update previously-created calendar blocks during replans.
  // Keep `extendedProperties` in sync on every write so priority / mutability / check-in state
  // survive edits made from Google Calendar clients on other devices.
  return {
    success: true,
    updatedCount: events.length,
    externalEventIds: [] as string[],
    payloads: events.map(buildGoogleCalendarEventPayload),
  }
}

// ##### END BACKEND #####
