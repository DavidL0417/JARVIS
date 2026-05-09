import { NextResponse } from "next/server"

import { buildDailyPlan } from "@/lib/daily-plan"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import {
  dailyPlanBuildRequestSchema,
  dailyPlanResponseSchema,
} from "@/schemas/daily-plan"
import type { DailyPlanResponse } from "@/schemas/daily-plan"

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const parsedBody = dailyPlanBuildRequestSchema.safeParse(body)

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid daily plan request",
        issues: parsedBody.error.flatten(),
      },
      { status: 400 },
    )
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const result = await buildDailyPlan({
      adminClient,
      userId: user.id,
      hardEvents: parsedBody.data.hardEvents,
      command: parsedBody.data.command,
    })
    const responsePayload: DailyPlanResponse = {
      success: true,
      dailyPlan: result.dailyPlan,
      schedule: result.schedule,
      taskCount: result.taskCount,
    }
    const parsedResponse = dailyPlanResponseSchema.safeParse(responsePayload)

    if (!parsedResponse.success) {
      return NextResponse.json(
        {
          error: "Invalid daily plan response payload",
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
        error: "Failed to build daily plan.",
        details: error instanceof Error ? error.message : "Unknown daily planning error.",
      },
      { status: 500 },
    )
  }
}
