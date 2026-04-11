import { NextResponse } from "next/server"

import { replanSchedule } from "@/lib/ai/claude"
import { replanRequestSchema } from "@/schemas/replan"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsedBody = replanRequestSchema.safeParse(body)

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid replan request",
        issues: parsedBody.error.flatten(),
      },
      { status: 400 },
    )
  }

  const result = await replanSchedule(parsedBody.data)

  // TODO: Reconcile pending tasks with existing events and persist the updated plan.
  return NextResponse.json({
    success: true,
    message: "Replan request validated.",
    result,
  })
}
