// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { NextResponse } from "next/server"

import { checkInRequestSchema } from "@/schemas/checkin"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
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

  // TODO: Store check-in history and trigger suggestion/replan logic from persisted state.
  return NextResponse.json({
    success: true,
    message: "Check-in payload validated.",
    completedTaskCount: parsedBody.data.completedTaskIds.length,
  })
}

// ##### END BACKEND #####
