// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { NextResponse } from "next/server"

import { mapCheckInPayloadToInsert, mapScheduleEventRowToScheduleEvent } from "@/lib/data/mappers"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import {
  checkInApprovalListResponseSchema,
  checkInRequestSchema,
  saveCheckInApprovalRequestSchema,
  saveCheckInApprovalResponseSchema,
} from "@/schemas/checkin"
import type {
  CheckInApprovalItem,
  CheckInApprovalListResponse,
  SaveCheckInApprovalResponse,
  ScheduleEventRow,
} from "@/types"

const SCHEDULE_EVENT_SELECT =
  "id, user_id, task_id, title, starts_at, ends_at, source, priority, status, location, external_event_id, gcal_event_id, last_synced_from, created_at, updated_at, is_immutable, is_checked_in, all_day, calendar_id"

function isApprovalPayload(value: unknown): value is { eventId: string } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "eventId" in value &&
      typeof (value as { eventId?: unknown }).eventId === "string",
  )
}

export async function GET() {
  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const { data, error } = await adminClient
      .from("schedule_events")
      .select(SCHEDULE_EVENT_SELECT)
      .eq("user_id", user.id)
      .eq("last_synced_from", "gcal")
      .eq("is_checked_in", false)
      .not("gcal_event_id", "is", null)
      .gte("ends_at", new Date().toISOString())
      .order("starts_at", { ascending: true })

    if (error) {
      throw new Error(error.message)
    }

    const items: CheckInApprovalItem[] = (data ?? []).map((row) => ({
      event: mapScheduleEventRowToScheduleEvent(row as ScheduleEventRow),
    }))

    const payload: CheckInApprovalListResponse = {
      success: true,
      items,
    }
    const parsed = checkInApprovalListResponseSchema.safeParse(payload)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid check-in approval response payload",
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
        error: "Failed to load check-in approvals.",
        details: error instanceof Error ? error.message : "Unknown check-in load error.",
      },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)

  if (isApprovalPayload(body)) {
    const parsedBody = saveCheckInApprovalRequestSchema.safeParse(body)

    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: "Invalid check-in approval request",
          issues: parsedBody.error.flatten(),
        },
        { status: 400 },
      )
    }

    try {
      const { adminClient, user } = await requireAuthenticatedUser()
      const { data: existing, error: existingError } = await adminClient
        .from("schedule_events")
        .select(SCHEDULE_EVENT_SELECT)
        .eq("id", parsedBody.data.eventId)
        .eq("user_id", user.id)
        .maybeSingle<ScheduleEventRow>()

      if (existingError) {
        throw new Error(existingError.message)
      }

      if (!existing) {
        return NextResponse.json({ error: "Check-in event not found." }, { status: 404 })
      }

      let canUpdateLinkedTask = false

      if (existing.task_id) {
        const { data: linkedTask, error: linkedTaskError } = await adminClient
          .from("tasks")
          .select("id, is_immutable")
          .eq("id", existing.task_id)
          .eq("user_id", user.id)
          .maybeSingle<{ id: string; is_immutable: boolean }>()

        if (linkedTaskError) {
          throw new Error(linkedTaskError.message)
        }

        canUpdateLinkedTask = Boolean(linkedTask && linkedTask.is_immutable === false)
      }

      const now = new Date().toISOString()
      const { data: updatedEvent, error: updateEventError } = await adminClient
        .from("schedule_events")
        .update({
          priority: parsedBody.data.priority,
          is_immutable: parsedBody.data.isImmutable,
          is_checked_in: true,
          updated_at: now,
        })
        .eq("id", existing.id)
        .eq("user_id", user.id)
        .select(SCHEDULE_EVENT_SELECT)
        .single<ScheduleEventRow>()

      if (updateEventError || !updatedEvent) {
        throw new Error(updateEventError?.message ?? "Failed to save check-in approval.")
      }

      if (existing.task_id && canUpdateLinkedTask) {
        const { error: updateTaskError } = await adminClient
          .from("tasks")
          .update({
            priority: parsedBody.data.priority,
            is_immutable: parsedBody.data.isImmutable,
            updated_at: now,
          })
          .eq("id", existing.task_id)
          .eq("user_id", user.id)

        if (updateTaskError) {
          throw new Error(updateTaskError.message)
        }
      }

      const payload: SaveCheckInApprovalResponse = {
        success: true,
        event: mapScheduleEventRowToScheduleEvent(updatedEvent),
      }
      const parsed = saveCheckInApprovalResponseSchema.safeParse(payload)

      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "Invalid check-in approval save response payload",
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
          error: "Failed to save check-in approval.",
          details: error instanceof Error ? error.message : "Unknown check-in save error.",
        },
        { status: 500 },
      )
    }
  }

  const parsedBody = checkInRequestSchema.safeParse(body)

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid check-in request",
        issues: parsedBody.error.flatten(),
      },
      { status: 400 },
    )
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const { error } = await adminClient.from("checkins").insert(
      mapCheckInPayloadToInsert(parsedBody.data, user.id),
    )

    if (error) {
      throw new Error(error.message)
    }

    return NextResponse.json({
      success: true,
      message: "Check-in recorded.",
      completedTaskCount: parsedBody.data.completedTaskIds.length,
    })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to save check-in.",
        details: error instanceof Error ? error.message : "Unknown check-in error.",
      },
      { status: 500 },
    )
  }
}

// ##### END BACKEND #####
