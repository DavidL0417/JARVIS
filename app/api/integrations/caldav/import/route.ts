import { NextResponse } from "next/server"

import { refreshCalDavForUser } from "@/lib/caldav/refresh"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"

export async function POST() {
  try {
    const { user } = await requireAuthenticatedUser()
    const result = await refreshCalDavForUser(user.id)

    if (!result.success) {
      return NextResponse.json(
        {
          error: result.error || "CalDAV refresh failed.",
          details: result.error || "CalDAV refresh failed.",
          needsAuthorization: result.needsAuthorization,
        },
        { status: result.needsAuthorization ? 409 : 502 },
      )
    }

    return NextResponse.json({
      success: true,
      details: `Imported ${result.events.length} CalDAV events from ${result.calendars.length} calendars.`,
    })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "CalDAV refresh failed.",
        details: error instanceof Error ? error.message : "Unknown CalDAV refresh error.",
      },
      { status: 500 },
    )
  }
}
