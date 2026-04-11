import { NextResponse } from "next/server"

import { generateSchedule } from "@/lib/ai/claude"
import { scheduleRequestSchema } from "@/schemas/schedule"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsedBody = scheduleRequestSchema.safeParse(body)

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid schedule request",
        issues: parsedBody.error.flatten(),
      },
      { status: 400 },
    )
  }

  const result = await generateSchedule(parsedBody.data)

  // TODO: Save generated schedule blocks and sync them to Google Calendar.
  return NextResponse.json({
    success: true,
    message: "Schedule request validated.",
    result,
  })
}
