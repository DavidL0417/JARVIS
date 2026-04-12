"use client"

import type { Session } from "@supabase/supabase-js"

import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import type { ScheduleEvent } from "@/types"

const DAY_IN_MS = 24 * 60 * 60 * 1000
const GOOGLE_EVENT_LOOKBACK_DAYS = 90
const GOOGLE_EVENT_LOOKAHEAD_DAYS = 180
const GOOGLE_PRIMARY_CALENDAR_ID = "cal-2"

type SupabaseOAuthSession = Session & {
  provider_token?: string | null
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
}

interface GoogleCalendarEventsResponse {
  items?: GoogleCalendarEventItem[]
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

function mapGoogleEventToScheduleEvent(item: GoogleCalendarEventItem): ScheduleEvent | null {
  const start = toEventTimestamp(item.start, "00:00")
  const isAllDay = Boolean(item.start?.date && !item.start?.dateTime)
  const end = isAllDay ? toAllDayEndTimestamp(item.end) : toEventTimestamp(item.end, "23:59")

  if (!start || !end) {
    return null
  }

  return {
    id: `google-${item.id}`,
    userId: "google-calendar",
    taskId: null,
    title: item.summary?.trim() || "Untitled event",
    start,
    end,
    source: "calendar",
    priority: "medium",
    status: null,
    location: item.location?.trim() || null,
    externalEventId: item.id,
    gcalEventId: item.id,
    lastSyncedFrom: "gcal",
    isImmutable: true,
    isCheckedIn: false,
    allDay: isAllDay,
    calendarId: GOOGLE_PRIMARY_CALENDAR_ID,
  }
}

export async function getGoogleProviderToken() {
  const supabase = createSupabaseBrowserClient()
  const { data, error } = await supabase.auth.getSession()

  if (error) {
    throw new Error(error.message)
  }

  const session = data.session as SupabaseOAuthSession | null
  const token = session?.provider_token

  if (!token) {
    throw new Error("Google Calendar token is unavailable in the current session.")
  }

  return token
}

export async function fetchGoogleEvents() {
  // Transitional helper:
  // the long-term sync contract is Google Calendar -> Supabase -> frontend.
  // Once the server-side mirror is live, the calendar UI should stop calling Google directly.
  const providerToken = await getGoogleProviderToken()
  const now = Date.now()
  const timeMin = new Date(now - GOOGLE_EVENT_LOOKBACK_DAYS * DAY_IN_MS).toISOString()
  const timeMax = new Date(now + GOOGLE_EVENT_LOOKAHEAD_DAYS * DAY_IN_MS).toISOString()
  const searchParams = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  })

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${searchParams.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${providerToken}`,
      },
      cache: "no-store",
    },
  )

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new Error(errorText || `Google Calendar sync failed with status ${response.status}.`)
  }

  const payload = (await response.json()) as GoogleCalendarEventsResponse
  const events = (payload.items || [])
    .map(mapGoogleEventToScheduleEvent)
    .filter((event): event is ScheduleEvent => event !== null)
    .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime())

  console.log("Successfully fetched Google Events:", events)

  return events
}
