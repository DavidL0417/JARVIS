import { NextResponse } from "next/server"
import { z } from "zod"

import { mapUserCalendarRowToUserCalendar, USER_CALENDAR_SELECT } from "@/lib/data/mappers"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { TASKS_CALENDAR_ID } from "@/lib/task-calendar-constants"
import {
  calendarMutationResponseSchema,
  updateCalendarRequestSchema,
} from "@/schemas/calendars"
import type {
  CalendarMutationResponse,
  UserCalendarRow,
} from "@/types"

const calendarIdSchema = z.string().uuid()

async function getValidatedCalendarId(params: Promise<{ id: string }>) {
  const { id } = await params
  return calendarIdSchema.safeParse(id)
}

async function loadCalendar(
  adminClient: Awaited<ReturnType<typeof requireAuthenticatedUser>>["adminClient"],
  userId: string,
  calendarId: string,
) {
  const { data, error } = await adminClient
    .from("calendars")
    .select(USER_CALENDAR_SELECT)
    .eq("id", calendarId)
    .eq("user_id", userId)
    .maybeSingle<UserCalendarRow>()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

async function hasDuplicateManagedCalendarName(
  adminClient: Awaited<ReturnType<typeof requireAuthenticatedUser>>["adminClient"],
  userId: string,
  name: string,
  excludeId: string,
) {
  const { data, error } = await adminClient
    .from("calendars")
    .select("id")
    .eq("user_id", userId)
    .in("source", ["local", "imported", "task"])
    .ilike("name", name)

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).some((calendar) => calendar.id !== excludeId)
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsedId = await getValidatedCalendarId(context.params)
  const body = await request.json().catch(() => null)
  const parsedBody = updateCalendarRequestSchema.safeParse(body)

  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid calendar id." }, { status: 400 })
  }

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid calendar update request",
        issues: parsedBody.error.flatten(),
      },
      { status: 400 },
    )
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const existing = await loadCalendar(adminClient, user.id, parsedId.data)

    if (!existing) {
      return NextResponse.json({ error: "Calendar not found." }, { status: 404 })
    }

    if ((existing.source === "google" || existing.source === "caldav") && (parsedBody.data.name || "isImmutable" in parsedBody.data)) {
      return NextResponse.json({ error: "Remote calendars are managed by sync. Visibility, color, and display preference can still be changed." }, { status: 409 })
    }

    if (parsedBody.data.name) {
      const hasDuplicate = await hasDuplicateManagedCalendarName(
        adminClient,
        user.id,
        parsedBody.data.name.trim(),
        existing.id,
      )

      if (hasDuplicate) {
        return NextResponse.json(
          { error: "A local calendar with that name already exists." },
          { status: 409 },
        )
      }
    }

    const { data, error } = await adminClient
      .from("calendars")
      .update({
        name: parsedBody.data.name?.trim() ?? existing.name,
        color: parsedBody.data.color?.trim() ?? existing.color,
        is_visible: parsedBody.data.isVisible ?? existing.is_visible,
        is_immutable: parsedBody.data.isImmutable ?? existing.is_immutable,
        sync_preference: parsedBody.data.syncPreference ?? existing.sync_preference,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("user_id", user.id)
      .select(USER_CALENDAR_SELECT)
      .single<UserCalendarRow>()

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to update calendar.")
    }

    const payload: CalendarMutationResponse = {
      success: true,
      calendar: mapUserCalendarRowToUserCalendar(data),
    }
    const parsed = calendarMutationResponseSchema.safeParse(payload)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid calendar update response payload",
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
        error: "Failed to update calendar.",
        details: error instanceof Error ? error.message : "Unknown calendar update error.",
      },
      { status: 500 },
    )
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsedId = await getValidatedCalendarId(context.params)

  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid calendar id." }, { status: 400 })
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const existing = await loadCalendar(adminClient, user.id, parsedId.data)

    if (!existing) {
      return NextResponse.json({ error: "Calendar not found." }, { status: 404 })
    }

    if (existing.is_task_calendar || existing.calendar_key === TASKS_CALENDAR_ID) {
      return NextResponse.json(
        { error: "Task Calendar is system-managed and cannot be deleted." },
        { status: 400 },
      )
    }

    if (existing.source === "google" || existing.source === "caldav") {
      return NextResponse.json({ error: "Remote calendars are removed by disconnect/resync." }, { status: 409 })
    }

    const [scheduleEventUpdate, taskUpdate, deleteResult] = await Promise.all([
      adminClient
        .from("schedule_events")
        .update({
          calendar_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id)
        .eq("calendar_id", existing.calendar_key),
      adminClient
        .from("tasks")
        .update({
          calendar_id: TASKS_CALENDAR_ID,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id)
        .eq("calendar_id", existing.calendar_key),
      adminClient
        .from("calendars")
        .delete()
        .eq("id", existing.id)
        .eq("user_id", user.id),
    ])

    if (scheduleEventUpdate.error || taskUpdate.error || deleteResult.error) {
      throw new Error(
        scheduleEventUpdate.error?.message ||
          taskUpdate.error?.message ||
          deleteResult.error?.message ||
          "Failed to delete calendar.",
      )
    }

    return NextResponse.json({ success: true, id: existing.id })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to delete calendar.",
        details: error instanceof Error ? error.message : "Unknown calendar delete error.",
      },
      { status: 500 },
    )
  }
}
