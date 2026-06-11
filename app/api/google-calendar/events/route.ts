import { NextResponse } from "next/server"

import {
  getGoogleCalendarMirrorForUser,
  syncGoogleCalendarEventsForUser,
} from "@/lib/google-calendar-events"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"

export async function GET() {
  try {
    const { user } = await requireAuthenticatedUser()
    const result = await getGoogleCalendarMirrorForUser(user.id)
    return NextResponse.json(result, { status: result.connected ? 200 : 409 })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json(
        {
          success: false,
          connected: false,
          needsAuthorization: true,
          error: "Authentication required.",
          events: [],
          calendars: [],
        },
        { status: 401 },
      )
    }

    return NextResponse.json(
      {
        success: false,
        connected: false,
        error: error instanceof Error ? error.message : "Failed to load Google Calendar mirror.",
        events: [],
        calendars: [],
      },
      { status: 500 },
    )
  }
}

export async function POST() {
  try {
    const { user } = await requireAuthenticatedUser()
    const result = await syncGoogleCalendarEventsForUser(user.id)
    return NextResponse.json(result, { status: result.success ? 200 : 409 })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json(
        {
          success: false,
          connected: false,
          needsAuthorization: true,
          error: "Authentication required.",
          events: [],
          calendars: [],
        },
        { status: 401 },
      )
    }

    return NextResponse.json(
      {
        success: false,
        connected: false,
        error: error instanceof Error ? error.message : "Failed to sync Google Calendar.",
        events: [],
        calendars: [],
      },
      { status: 500 },
    )
  }
}
