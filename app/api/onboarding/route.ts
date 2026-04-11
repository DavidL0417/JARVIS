// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { NextResponse } from "next/server"

import { onboardingRequestSchema } from "@/schemas/onboarding"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsedBody = onboardingRequestSchema.safeParse(body)

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid onboarding request",
        issues: parsedBody.error.flatten(),
      },
      { status: 400 },
    )
  }

  // TODO: Persist onboarding state and user preferences once Supabase auth/data flow exists.
  return NextResponse.json({
    success: true,
    message: "Onboarding payload validated.",
    user: parsedBody.data.name,
  })
}

// ##### END BACKEND #####
