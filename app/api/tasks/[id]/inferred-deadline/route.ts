import { NextResponse } from "next/server"
import { z } from "zod"

import { isAuthenticationRequiredError, requireAuthenticatedUser } from "@/lib/supabase/auth"
import { inferredDeadlineDecisionSchema } from "@/schemas/deadlines"

const taskIdSchema = z.string().uuid()

// Resolve a suggested deadline. "accept" promotes the inferred by-when to the
// task's real deadline (approval before the write); "dismiss" is "Keep undated"
// — clears the suggestion and suppresses re-suggestion. Kept off the protected
// public task-update schema as its own small endpoint.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const parsedId = taskIdSchema.safeParse(id)
  const body = await request.json().catch(() => null)
  const parsed = inferredDeadlineDecisionSchema.safeParse(body)

  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid task id." }, { status: 400 })
  }

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid inferred-deadline decision", issues: parsed.error.flatten() },
      { status: 400 },
    )
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const now = new Date().toISOString()

    if (parsed.data.action === "dismiss") {
      const { error } = await adminClient
        .from("tasks")
        .update({
          inferred_deadline: null,
          inferred_deadline_reason: null,
          inferred_deadline_dismissed: true,
          updated_at: now,
        })
        .eq("id", parsedId.data)
        .eq("user_id", user.id)

      if (error) {
        throw new Error(error.message)
      }

      return NextResponse.json({ success: true })
    }

    // accept: promote the cached suggestion to the real deadline.
    const { data: taskRow, error: readError } = await adminClient
      .from("tasks")
      .select("inferred_deadline")
      .eq("id", parsedId.data)
      .eq("user_id", user.id)
      .maybeSingle<{ inferred_deadline: string | null }>()

    if (readError) {
      throw new Error(readError.message)
    }

    if (!taskRow) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 })
    }

    if (!taskRow.inferred_deadline) {
      return NextResponse.json({ error: "No inferred deadline to accept." }, { status: 409 })
    }

    const { error } = await adminClient
      .from("tasks")
      .update({
        deadline: taskRow.inferred_deadline,
        inferred_deadline: null,
        inferred_deadline_reason: null,
        updated_at: now,
      })
      .eq("id", parsedId.data)
      .eq("user_id", user.id)

    if (error) {
      throw new Error(error.message)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to resolve inferred deadline.",
        details: error instanceof Error ? error.message : "Unknown inferred-deadline error.",
      },
      { status: 500 },
    )
  }
}
