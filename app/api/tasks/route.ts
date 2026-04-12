// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { NextResponse } from "next/server"

import { mapTaskRowToTask } from "@/lib/data/mappers"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { TASKS_CALENDAR_ID } from "@/lib/task-calendar-constants"
import { createTaskRequestSchema, taskMutationResponseSchema } from "@/schemas/tasks"
import type { CreateTaskRequest, Task, TaskMutationResponse, TaskRow } from "@/types"

function buildTaskInsert(input: CreateTaskRequest, userId: string) {
  const task: Task = {
    id: crypto.randomUUID(),
    userId,
    title: input.title,
    description: input.description ?? null,
    deadline: input.deadline ?? null,
    durationMinutes: input.durationMinutes ?? null,
    priority: input.priority ?? "medium",
    status: input.status ?? "todo",
    scheduledFor: input.scheduledFor ?? null,
    isImmutable: input.isImmutable ?? false,
    allDay: input.allDay ?? false,
    calendarId: TASKS_CALENDAR_ID,
    tags: input.tags ?? [],
  }

  return {
    user_id: task.userId,
    title: task.title,
    description: task.description,
    deadline: task.deadline,
    duration_minutes: task.durationMinutes,
    priority: task.priority,
    status: task.status,
    scheduled_for: task.scheduledFor,
    is_immutable: task.isImmutable,
    all_day: task.allDay,
    calendar_id: task.calendarId,
    tags: task.tags,
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsedBody = createTaskRequestSchema.safeParse(body)

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid task create request",
        issues: parsedBody.error.flatten(),
      },
      { status: 400 },
    )
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()

    const { data, error } = await adminClient
      .from("tasks")
      .insert(buildTaskInsert(parsedBody.data, user.id))
      .select(
        "id, user_id, title, description, deadline, duration_minutes, priority, status, scheduled_for, created_at, updated_at, is_immutable, all_day, calendar_id, tags",
      )
      .single<TaskRow>()

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to create task.")
    }

    const responsePayload: TaskMutationResponse = {
      success: true,
      task: mapTaskRowToTask(data),
    }

    const parsedResponse = taskMutationResponseSchema.safeParse(responsePayload)

    if (!parsedResponse.success) {
      return NextResponse.json(
        {
          error: "Invalid task create response payload",
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
        error: "Failed to create task.",
        details: error instanceof Error ? error.message : "Unknown task create error.",
      },
      { status: 500 },
    )
  }
}

// ##### END BACKEND #####
