// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { NextResponse } from "next/server"
import type { Session } from "@supabase/supabase-js"

import { getGoogleTokensFromSession, upsertGoogleCalendarIntegration } from "@/lib/supabase/google-calendar-integration"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { getOrCreateUserProfile } from "@/lib/supabase/auth"
import { ensureTaskCalendarForUser } from "@/lib/tasks-calendar"

function getSafeRedirectPath(candidate: string | null) {
  if (!candidate || !candidate.startsWith("/")) {
    return "/dashboard"
  }

  return candidate
}

function getRedirectOrigin(request: Request, fallbackOrigin: string) {
  const isLocal = process.env.NODE_ENV === "development"
  const forwardedHost = request.headers.get("x-forwarded-host")
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https"

  if (!isLocal && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`
  }

  return fallbackOrigin
}

async function bootstrapAuthenticatedGoogleUser(oauthSession: Session | null) {
  const supabase = await createSupabaseServerClient()
  const { data: userData } = await supabase.auth.getUser()

  if (!userData.user) {
    return
  }

  let googleTokens = getGoogleTokensFromSession(oauthSession)

  if (!googleTokens.accessToken && !googleTokens.refreshToken) {
    const { data: sessionData } = await supabase.auth.getSession()
    googleTokens = getGoogleTokensFromSession(sessionData.session)
  }

  const profile = await getOrCreateUserProfile(userData.user)
  await upsertGoogleCalendarIntegration({
    userId: profile.id,
    authUser: userData.user,
    ...googleTokens,
  })
  await ensureTaskCalendarForUser(profile.id)
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const next = getSafeRedirectPath(requestUrl.searchParams.get("next"))

  if (code) {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      try {
        await bootstrapAuthenticatedGoogleUser(data.session)
      } catch (bootstrapError) {
        console.error("Google auth callback bootstrap failed after session exchange.", bootstrapError)
      }

      return NextResponse.redirect(new URL(next, getRedirectOrigin(request, requestUrl.origin)))
    }
  }

  return NextResponse.redirect(new URL("/dashboard?authError=callback", getRedirectOrigin(request, requestUrl.origin)))
}

// ##### END BACKEND #####
