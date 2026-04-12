// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { NextResponse } from "next/server"
import { z } from "zod"

import { mapTaskRowToTask, mapTaskToUpdate } from "@/lib/data/mappers"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { TASKS_CALENDAR_ID } from "@/lib/tasks-calendar"
import {
  deleteTaskResponseSchema,
  taskMutationResponseSchema,
  updateTaskRequestSchema,
} from "@/schemas/tasks"
import type { DeleteTaskResponse, TaskMutationResponse, TaskRow } from "@/types"

const taskIdSchema = z.string().uuid()

async function getValidatedTaskId(params: Promise<{ id: string }>) {
  const { id } = await params
  return taskIdSchema.safeParse(id)
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsedTaskId = await getValidatedTaskId(context.params)
  const body = await request.json().catch(() => null)
  const parsedBody = updateTaskRequestSchema.safeParse(body)

  if (!parsedTaskId.success) {
    return NextResponse.json({ error: "Invalid task id." }, { status: 400 })
  }

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid task update request",
        issues: parsedBody.error.flatten(),
      },
      { status: 400 },
    )
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()

    const { data, error } = await adminClient
      .from("tasks")
      .update({
        ...mapTaskToUpdate(parsedBody.data),
        calendar_id: TASKS_CALENDAR_ID,
        updated_at: new Date().toISOString(),
      })
      .eq("id", parsedTaskId.data)
      .eq("user_id", user.id)
      .select(
        "id, user_id, title, description, deadline, duration_minutes, priority, status, scheduled_for, created_at, updated_at, is_immutable, all_day, calendar_id, tags",
      )
      .maybeSingle<TaskRow>()

    if (error) {
      throw new Error(error.message)
    }

    if (!data) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 })
    }

    const responsePayload: TaskMutationResponse = {
      success: true,
      task: mapTaskRowToTask(data),
    }

    const parsedResponse = taskMutationResponseSchema.safeParse(responsePayload)

    if (!parsedResponse.success) {
      return NextResponse.json(
        {
          error: "Invalid task update response payload",
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
        error: "Failed to update task.",
        details: error instanceof Error ? error.message : "Unknown task update error.",
      },
      { status: 500 },
    )
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsedTaskId = await getValidatedTaskId(context.params)

  if (!parsedTaskId.success) {
    return NextResponse.json({ error: "Invalid task id." }, { status: 400 })
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()

    const { data, error } = await adminClient
      .from("tasks")
      .delete()
      .eq("id", parsedTaskId.data)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle<{ id: string }>()

    if (error) {
      throw new Error(error.message)
    }

    if (!data) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 })
    }

    const responsePayload: DeleteTaskResponse = {
      success: true,
      id: data.id,
    }

    const parsedResponse = deleteTaskResponseSchema.safeParse(responsePayload)

    if (!parsedResponse.success) {
      return NextResponse.json(
        {
          error: "Invalid task delete response payload",
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
        error: "Failed to delete task.",
        details: error instanceof Error ? error.message : "Unknown task delete error.",
      },
      { status: 500 },
    )
  }
}

// ##### END BACKEND #####
