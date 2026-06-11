import { NextResponse } from "next/server"

import { mapUserCalendarRowToUserCalendar, USER_CALENDAR_SELECT } from "@/lib/data/mappers"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { ensureTaskCalendarForUser, listUserCalendars } from "@/lib/tasks-calendar"
import {
  calendarListResponseSchema,
  calendarMutationResponseSchema,
  createCalendarRequestSchema,
} from "@/schemas/calendars"
import type {
  CalendarListResponse,
  CalendarMutationResponse,
  UserCalendarRow,
} from "@/types"

const DEFAULT_CALENDAR_COLOR = "#bfdbfe"
const MANAGED_SOURCES = ["local", "imported", "task"] as const

async function hasDuplicateManagedCalendarName(
  adminClient: Awaited<ReturnType<typeof requireAuthenticatedUser>>["adminClient"],
  userId: string,
  name: string,
) {
  const { data, error } = await adminClient
    .from("calendars")
    .select("id")
    .eq("user_id", userId)
    .in("source", [...MANAGED_SOURCES])
    .ilike("name", name)
    .limit(1)

  if (error) {
    throw new Error(error.message)
  }

  return (data?.length ?? 0) > 0
}

export async function GET() {
  try {
    const { user } = await requireAuthenticatedUser()
    await ensureTaskCalendarForUser(user.id)
    const calendars = await listUserCalendars(user.id)

    const payload: CalendarListResponse = {
      success: true,
      calendars,
    }

    const parsed = calendarListResponseSchema.safeParse(payload)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid calendars response payload",
          issues: parsed.error.flatten(),
        },
        { status: 500 },
      )
    }

    return NextResponse.json(parsed.data)
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to load calendars.",
        details: error instanceof Error ? error.message : "Unknown calendars error.",
      },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsedBody = createCalendarRequestSchema.safeParse(body)

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid calendar create request",
        issues: parsedBody.error.flatten(),
      },
      { status: 400 },
    )
  }

  if (parsedBody.data.source === "task" || parsedBody.data.source === "google" || parsedBody.data.source === "caldav") {
    return NextResponse.json(
      { error: "Remote and task calendars are system-managed and cannot be created manually." },
      { status: 400 },
    )
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const trimmedName = parsedBody.data.name.trim()
    const hasDuplicate = await hasDuplicateManagedCalendarName(adminClient, user.id, trimmedName)

    if (hasDuplicate) {
      return NextResponse.json(
        { error: "A local calendar with that name already exists." },
        { status: 409 },
      )
    }

    const { data, error } = await adminClient
      .from("calendars")
      .insert({
        user_id: user.id,
        calendar_key: `calendar-${crypto.randomUUID()}`,
        name: trimmedName,
        color: parsedBody.data.color?.trim() || DEFAULT_CALENDAR_COLOR,
        source: parsedBody.data.source,
        google_calendar_id: null,
        remote_name: null,
        is_visible: true,
        is_immutable: parsedBody.data.isImmutable,
        sync_preference: "active",
        is_task_calendar: false,
        updated_at: new Date().toISOString(),
      })
      .select(USER_CALENDAR_SELECT)
      .single<UserCalendarRow>()

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to create calendar.")
    }

    const payload: CalendarMutationResponse = {
      success: true,
      calendar: mapUserCalendarRowToUserCalendar(data),
    }
    const parsed = calendarMutationResponseSchema.safeParse(payload)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid calendar create response payload",
          issues: parsed.error.flatten(),
        },
        { status: 500 },
      )
    }

    return NextResponse.json(parsed.data)
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to create calendar.",
        details: error instanceof Error ? error.message : "Unknown calendar create error.",
      },
      { status: 500 },
    )
  }
}
