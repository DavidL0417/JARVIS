"use client"

import type { GoogleCalendarSyncResponse } from "@/types"
import { GOOGLE_SOURCE_SCOPES } from "@/lib/google-oauth"
import { tryCreateSupabaseBrowserClient } from "@/lib/supabase/client"

// A single in-flight guard shared by every OAuth entry point on the page.
//
// PKCE stores a one-time code_verifier in a single cookie that signInWithOAuth
// OVERWRITES on every call. If a second OAuth redirect starts before the server
// exchanges the first code (e.g. an impatient re-click, or the landing Sign in
// and a dashboard authorize firing across a transition), it clobbers the
// verifier and the exchange fails with GoTrue "code challenge does not match
// previously saved code verifier" — which dumps the user back on the Site URL
// (the home page). The per-component pending flags don't catch cross-component
// races; this module-level flag does. It is intentionally left set on success
// because the page is navigating away to Google; a full page (re)load — including
// a bfcache restore via pageshow — clears it so legitimate retries still work.
let oauthRedirectInFlight = false

if (typeof window !== "undefined") {
  window.addEventListener("pageshow", () => {
    oauthRedirectInFlight = false
  })
}

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
  if (oauthRedirectInFlight) {
    return
  }
  oauthRedirectInFlight = true

  const supabase = tryCreateSupabaseBrowserClient()

  if (!supabase) {
    oauthRedirectInFlight = false
    throw new Error("Supabase auth is not configured.")
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: getAuthRedirectTo(nextPath),
    },
  })

  if (error) {
    oauthRedirectInFlight = false
    throw new Error(error.message)
  }
}

export async function startGoogleSourceAuthorizationRedirect(nextPath?: string) {
  if (oauthRedirectInFlight) {
    return
  }
  oauthRedirectInFlight = true

  const supabase = tryCreateSupabaseBrowserClient()

  if (!supabase) {
    oauthRedirectInFlight = false
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
    oauthRedirectInFlight = false
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
