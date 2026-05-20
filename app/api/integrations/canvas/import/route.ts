import { NextResponse } from "next/server"

import { refreshCanvasForUser } from "@/lib/sources/canvas-refresh"
import { insertSourceSnapshot } from "@/lib/sources/persistence"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { sourceIntakeResponseSchema } from "@/schemas/sources"

function parseCanvasRefreshError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown Canvas import error."
  const needsAuthorization = message.startsWith("CANVAS_REAUTH_REQUIRED:")
  const details = message.replace("CANVAS_REAUTH_REQUIRED:", "").trim()

  if (needsAuthorization) {
    return {
      status: 409,
      error: details || "Canvas is not connected.",
      details,
      needsAuthorization: true,
      reason: "reauthorization_required",
    }
  }

  return {
    status: 500,
    error: "Failed to import Canvas planner items.",
    details: details || message,
    needsAuthorization: false,
    reason: "canvas_import_failed",
  }
}

export async function POST() {
  let userId: string | null = null

  try {
    const { user } = await requireAuthenticatedUser()
    userId = user.id
    const responsePayload = await refreshCanvasForUser(user.id)
    return NextResponse.json(sourceIntakeResponseSchema.parse(responsePayload))
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    const parsedError = parseCanvasRefreshError(error)

    if (userId) {
      try {
        const { adminClient } = await requireAuthenticatedUser()
        await insertSourceSnapshot({
          adminClient,
          userId,
          source: "canvas",
          sourceRef: null,
          freshness: "failed",
          summary: parsedError.details || parsedError.error,
          payload: {
            reason: parsedError.reason,
          },
        })
      } catch (recordError) {
        console.error("Failed to record Canvas import failure state.", recordError)
      }
    }

    return NextResponse.json(
      {
        error: parsedError.error,
        details: parsedError.details,
        needsAuthorization: parsedError.needsAuthorization,
      },
      { status: parsedError.status },
    )
  }
}
