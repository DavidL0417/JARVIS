import type { DAVCalendar } from "tsdav"

import { buildEventIcs, generateEventUid, icsFilename } from "@/lib/caldav/ics"
import { createCalDavClient, normalizeCalendarName, supportsCalendarEvents } from "@/lib/caldav/refresh"
import { loadUserTimezone } from "@/lib/data/user-timezone"
import { getStoredCalDavIntegration, markCalDavIntegrationStatus } from "@/lib/supabase/caldav-integration"

export interface CreateCalDavEventInput {
  title: string
  startIso: string
  endIso: string
  // Name of an EXISTING Apple calendar to target (case-insensitive). Omitted writes
  // to the first writable calendar. We never create a calendar.
  calendarName?: string | null
  description?: string | null
  location?: string | null
  allDay?: boolean
}

export interface CreateCalDavEventResult {
  connected: boolean
  created: boolean
  error?: string
  calendarSummary?: string
  availableCalendars?: string[]
  uid?: string
  objectUrl?: string
  etag?: string
}

const AUTH_ERROR_PATTERN =
  /authorization|authentication|unauthorized|forbidden|invalid credentials|status 401|status 403/i

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`
}

// Create a single event on the user's Apple/iCloud Calendar via CalDAV, mirroring
// createGoogleCalendarEventForUser. Approval-gated upstream (the agent loop queues a
// pending approval; the approve route calls this on confirm). Reuses the existing
// CalDAV read stack — the stored app-specific password is read/write capable. We
// never create a calendar; an unmatched name is a hard error.
export async function createCalDavEventForUser(
  userId: string,
  input: CreateCalDavEventInput,
): Promise<CreateCalDavEventResult> {
  const integration = await getStoredCalDavIntegration(userId)
  if (!integration?.server_url || !integration.provider_account_email || !integration.password) {
    return { connected: false, created: false, error: "Apple Calendar (CalDAV) is not connected." }
  }

  const title = input.title?.trim()
  if (!title) {
    return { connected: true, created: false, error: "An event title is required." }
  }
  if (!input.startIso || !input.endIso) {
    return { connected: true, created: false, error: "Both a start and end time are required." }
  }

  const requestedName = input.calendarName?.trim()

  try {
    const client = createCalDavClient({
      serverUrl: integration.server_url,
      username: integration.provider_account_email,
      password: integration.password,
    })
    await client.login()

    const calendars = (await client.fetchCalendars()) as DAVCalendar[]
    // Drop VTODO-only reminder lists; only event-capable calendars are writable here.
    const writable = calendars.filter((calendar) => supportsCalendarEvents(calendar))

    let target: DAVCalendar | undefined
    if (requestedName) {
      target = writable.find(
        (calendar) => normalizeCalendarName(calendar.displayName).toLowerCase() === requestedName.toLowerCase(),
      )
      if (!target) {
        return {
          connected: true,
          created: false,
          error: `No Apple calendar named "${requestedName}" was found. JARVIS can add events to an existing calendar but cannot create a new one.`,
          availableCalendars: writable.map((calendar) => normalizeCalendarName(calendar.displayName)),
        }
      }
    } else {
      target = writable[0]
      if (!target) {
        return { connected: true, created: false, error: "No writable Apple calendar was found." }
      }
    }

    const calendarSummary = normalizeCalendarName(target.displayName)
    const timeZone = await loadUserTimezone(userId)

    const writeOnce = async (uid: string) => {
      const iCalString = buildEventIcs({
        uid,
        title,
        startIso: input.startIso,
        endIso: input.endIso,
        allDay: input.allDay ?? false,
        timeZone,
        location: input.location,
        description: input.description,
      })
      return client.createCalendarObject({ calendar: target as DAVCalendar, filename: icsFilename(uid), iCalString })
    }

    let uid = generateEventUid()
    let response = await writeOnce(uid)

    // 412 = If-None-Match collision (the resource name already exists). Our UIDs are
    // random, so this is rare — regenerate once and retry.
    if (!response.ok && response.status === 412) {
      uid = generateEventUid()
      response = await writeOnce(uid)
    }

    if (!response.ok) {
      if (response.status === 403) {
        return {
          connected: true,
          created: false,
          error: "Apple rejected the write (403). The app-specific password may lack calendar write access.",
        }
      }
      const bodyText = await response.text().catch(() => "")
      return {
        connected: true,
        created: false,
        error: bodyText || `Apple Calendar write failed with status ${response.status}.`,
      }
    }

    return {
      connected: true,
      created: true,
      calendarSummary,
      uid,
      objectUrl: new URL(icsFilename(uid), ensureTrailingSlash(target.url)).href,
      etag: response.headers.get("etag") ?? undefined,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Apple Calendar write failed."
    if (AUTH_ERROR_PATTERN.test(message)) {
      await markCalDavIntegrationStatus({ userId, status: "needs_reauth" }).catch(() => null)
      return { connected: true, created: false, error: "Apple Calendar needs reconnection (authorization failed)." }
    }
    return { connected: true, created: false, error: message }
  }
}
