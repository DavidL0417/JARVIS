import { google } from "googleapis"

import type { ScheduleEvent } from "@/types"

export function getGoogleOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri) {
    return null
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

export async function createCalendarEvents(events: ScheduleEvent[]) {
  const authClient = getGoogleOAuthClient()

  void authClient

  // TODO: Insert generated schedule blocks into the user's selected Google Calendar.
  return {
    success: true,
    createdCount: events.length,
    externalEventIds: [] as string[],
  }
}

export async function updateCalendarEvents(events: ScheduleEvent[]) {
  const authClient = getGoogleOAuthClient()

  void authClient

  // TODO: Diff and update previously-created calendar blocks during replans.
  return {
    success: true,
    updatedCount: events.length,
    externalEventIds: [] as string[],
  }
}
