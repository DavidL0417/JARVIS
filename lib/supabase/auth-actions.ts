"use client"

import type { GoogleCalendarSyncResponse } from "@/types"
import { tryCreateSupabaseBrowserClient } from "@/lib/supabase/client"

const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ")

export class GoogleCalendarAuthorizationError extends Error {
  constructor(message = "Google Calendar needs authorization.") {
    super(message)
    this.name = "GoogleCalendarAuthorizationError"
  }
}

export function isGoogleCalendarAuthorizationError(error: unknown) {
  return error instanceof GoogleCalendarAuthorizationError
}

function responseNeedsGoogleAuthorization(response: Response, payload: GoogleCalendarSyncResponse | null) {
  if (payload?.needsAuthorization) {
    return true
  }

  const message = payload?.error ?? ""
  return (
    response.status === 401 ||
    (response.status === 409 && /authorization|reauthorization|not connected|needs reauth/i.test(message))
  )
}

export async function startGoogleOAuthRedirect(nextPath?: string) {
  const supabase = tryCreateSupabaseBrowserClient()

  if (!supabase) {
    throw new Error("Supabase auth is not configured.")
  }

  const next =
    nextPath ??
    (typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`)
  const redirectTo =
    typeof window === "undefined"
      ? undefined
      : `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      scopes: GOOGLE_CALENDAR_SCOPES,
      queryParams: {
        access_type: "offline",
        include_granted_scopes: "true",
        prompt: "consent",
      },
    },
  })

  if (error) {
    throw new Error(error.message)
  }
}

export async function fetchGoogleEvents() {
  const response = await fetch("/api/google-calendar/events", {
    method: "POST",
    cache: "no-store",
  })
  const payload = (await response.json().catch(() => null)) as GoogleCalendarSyncResponse | null

  if (!response.ok || !payload?.success) {
    const message = payload?.error || `Google Calendar sync failed with status ${response.status}.`

    if (responseNeedsGoogleAuthorization(response, payload)) {
      throw new GoogleCalendarAuthorizationError(message)
    }

    throw new Error(message)
  }

  return payload.events || []
}
