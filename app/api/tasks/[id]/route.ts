import { NextResponse } from "next/server"
import { z } from "zod"

import { archiveNotionPageForTask } from "@/lib/sources/notion-completion"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { applyTaskUpdate } from "@/lib/tasks/mutations"
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

    const result = await applyTaskUpdate({
      adminClient,
      userId: user.id,
      taskId: parsedTaskId.data,
      fields: parsedBody.data,
    })

    if (!result.ok) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 })
    }

    const responsePayload: TaskMutationResponse = {
      success: true,
      task: result.task,
      externalWrite: result.externalWrite,
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

    const { error: deleteScheduleEventsError } = await adminClient
      .from("schedule_events")
      .delete()
      .eq("user_id", user.id)
      .eq("task_id", parsedTaskId.data)

    if (deleteScheduleEventsError) {
      throw new Error(deleteScheduleEventsError.message)
    }

    const { data, error } = await adminClient
      .from("tasks")
      .delete()
      .eq("id", parsedTaskId.data)
      .eq("user_id", user.id)
      .select("id, title, external_task_id, last_synced_from")
      .maybeSingle<Pick<TaskRow, "id" | "title" | "external_task_id" | "last_synced_from">>()

    if (error) {
      throw new Error(error.message)
    }

    if (!data) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 })
    }

    // Notion two-way write-back: deleting a Notion-linked task archives its Notion
    // page so Notion stays in sync. Best-effort side effect.
    await archiveNotionPageForTask({ adminClient, userId: user.id, task: data }).catch(() => null)

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
