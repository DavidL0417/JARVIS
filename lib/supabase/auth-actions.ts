"use client"

import type { GoogleCalendarSyncResponse } from "@/types"
import { GOOGLE_SOURCE_SCOPES } from "@/lib/google-oauth"
import { tryCreateSupabaseBrowserClient } from "@/lib/supabase/client"

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

function getAuthRedirectTo(nextPath?: string) {
  const next =
    nextPath ??
    (typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`)

  if (typeof window === "undefined") {
    return undefined
  }

  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
}

export async function startGoogleSignInRedirect(nextPath = "/dashboard") {
  const supabase = tryCreateSupabaseBrowserClient()

  if (!supabase) {
    throw new Error("Supabase auth is not configured.")
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: getAuthRedirectTo(nextPath),
    },
  })

  if (error) {
    throw new Error(error.message)
  }
}

export async function startGoogleSourceAuthorizationRedirect(nextPath?: string) {
  const supabase = tryCreateSupabaseBrowserClient()

  if (!supabase) {
    throw new Error("Supabase auth is not configured.")
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: getAuthRedirectTo(nextPath),
      scopes: GOOGLE_SOURCE_SCOPES,
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

export async function fetchCalDavEvents() {
  const response = await fetch("/api/integrations/caldav/import", {
    method: "POST",
    cache: "no-store",
  })
  const payload = (await response.json().catch(() => null)) as
    | { success?: boolean; error?: string; details?: string; needsAuthorization?: boolean }
    | null

  if (!response.ok || !payload?.success) {
    throw new Error(payload?.details || payload?.error || `CalDAV sync failed with status ${response.status}.`)
  }
}
