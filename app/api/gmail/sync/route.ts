import { NextResponse } from "next/server"

import { refreshGmailForUser, GMAIL_CONTEXT_SEARCH_QUERY } from "@/lib/sources/gmail-refresh"
import { insertSourceSnapshot } from "@/lib/sources/persistence"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import {
  getGoogleTokensFromSession,
  upsertGoogleCalendarIntegration,
} from "@/lib/supabase/google-calendar-integration"
import { sourceIntakeResponseSchema } from "@/schemas/sources"

export async function POST() {
  let userId: string | null = null

  try {
    const { authUser, serverClient, user } = await requireAuthenticatedUser()
    userId = user.id
    const { data: sessionData } = await serverClient.auth.getSession()
    const sessionTokens = getGoogleTokensFromSession(sessionData.session)

    if (sessionTokens.accessToken || sessionTokens.refreshToken) {
      await upsertGoogleCalendarIntegration({
        userId: user.id,
        authUser,
        ...sessionTokens,
      })
    }

    const result = await refreshGmailForUser(user.id)
    return NextResponse.json(sourceIntakeResponseSchema.parse(result))
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    const message = error instanceof Error ? error.message : "Unknown Gmail scan error."

    if (message.startsWith("GMAIL_API_DISABLED:") || message.startsWith("GMAIL_REAUTH_REQUIRED:")) {
      const needsAuthorization = message.startsWith("GMAIL_REAUTH_REQUIRED:")
      const detail = message
        .replace("GMAIL_API_DISABLED:", "")
        .replace("GMAIL_REAUTH_REQUIRED:", "")
        .trim()

      if (userId) {
        try {
          const adminClient = createSupabaseAdminClient()

          if (needsAuthorization) {
            await adminClient
              .from("integrations")
              .update({
                status: "needs_reauth",
                updated_at: new Date().toISOString(),
              })
              .eq("user_id", userId)
              .eq("provider", "google")
          }

          await insertSourceSnapshot({
            adminClient,
            userId,
            source: "gmail",
            sourceRef: GMAIL_CONTEXT_SEARCH_QUERY,
            freshness: "failed",
            summary: detail,
            payload: {
              reason: needsAuthorization ? "reauthorization_required" : "gmail_api_disabled",
            },
          })
        } catch (recordError) {
          console.error("Failed to record Gmail scan failure state.", recordError)
        }
      }

      return NextResponse.json(
        {
          error: detail,
          needsAuthorization,
        },
        { status: needsAuthorization ? 409 : 503 },
      )
    }

    return NextResponse.json(
      {
        error: "Failed to scan Gmail.",
        details: message,
      },
      { status: 500 },
    )
  }
}
