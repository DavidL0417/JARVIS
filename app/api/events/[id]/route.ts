import { NextResponse } from "next/server"
import { z } from "zod"

import {
  mapScheduleEventRowToScheduleEvent,
  SCHEDULE_EVENT_SELECT,
} from "@/lib/data/mappers"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import {
  scheduleEventUpdateRequestSchema,
  scheduleEventUpdateResponseSchema,
} from "@/schemas/schedule"
import type { ScheduleEventRow } from "@/types"

const eventIdSchema = z.string().uuid()

async function getValidatedEventId(params: Promise<{ id: string }>) {
  const { id } = await params
  return eventIdSchema.safeParse(id)
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsedEventId = await getValidatedEventId(context.params)
  const body = await request.json().catch(() => null)
  const parsedBody = scheduleEventUpdateRequestSchema.safeParse(body)

  if (!parsedEventId.success) {
    return NextResponse.json({ error: "Invalid event id." }, { status: 400 })
  }

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid event update request",
        issues: parsedBody.error.flatten(),
      },
      { status: 400 },
    )
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const now = new Date().toISOString()
    const updatePayload = {
      ...(parsedBody.data.priority ? { priority: parsedBody.data.priority } : {}),
      ...(parsedBody.data.isImmutable !== undefined
        ? { is_immutable: parsedBody.data.isImmutable }
        : {}),
      is_checked_in: true,
      updated_at: now,
    }

    const { data: updatedEvent, error: updateEventError } = await adminClient
      .from("schedule_events")
      .update(updatePayload)
      .eq("id", parsedEventId.data)
      .eq("user_id", user.id)
      .select(SCHEDULE_EVENT_SELECT)
      .maybeSingle<ScheduleEventRow>()

    if (updateEventError) {
      throw new Error(updateEventError.message)
    }

    if (!updatedEvent) {
      return NextResponse.json({ error: "Event not found." }, { status: 404 })
    }

    if (updatedEvent.task_id) {
      const taskUpdatePayload = {
        ...(parsedBody.data.priority ? { priority: parsedBody.data.priority } : {}),
        ...(parsedBody.data.isImmutable !== undefined
          ? { is_immutable: parsedBody.data.isImmutable }
          : {}),
        updated_at: now,
      }
      const { error: updateTaskError } = await adminClient
        .from("tasks")
        .update(taskUpdatePayload)
        .eq("id", updatedEvent.task_id)
        .eq("user_id", user.id)

      if (updateTaskError) {
        throw new Error(updateTaskError.message)
      }
    }

    const responsePayload = {
      success: true,
      event: mapScheduleEventRowToScheduleEvent(updatedEvent),
    }
    const parsedResponse = scheduleEventUpdateResponseSchema.safeParse(responsePayload)

    if (!parsedResponse.success) {
      return NextResponse.json(
        {
          error: "Invalid event update response payload",
          issues: parsedResponse.error.flatten(),
        },
        { status: 500 },
      )
    }

    return NextResponse.json(parsedResponse.data)
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to update event.",
        details: error instanceof Error ? error.message : "Unknown event update error.",
      },
      { status: 500 },
    )
  }
}
