import { NextResponse } from "next/server"

import { approveSourceCandidates } from "@/lib/sources/persistence"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import {
  approveCandidatesRequestSchema,
  approveCandidatesResponseSchema,
} from "@/schemas/sources"
import type { ApproveCandidatesResponse } from "@/schemas/sources"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsedBody = approveCandidatesRequestSchema.safeParse(body)

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid candidate approval request",
        issues: parsedBody.error.flatten(),
      },
      { status: 400 },
    )
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const approval = await approveSourceCandidates({
      adminClient,
      userId: user.id,
      candidateIds: parsedBody.data.candidateIds,
    })
    const responsePayload: ApproveCandidatesResponse = {
      success: true,
      tasks: approval.tasks,
      candidates: approval.candidates,
    }
    const parsedResponse = approveCandidatesResponseSchema.safeParse(responsePayload)

    if (!parsedResponse.success) {
      return NextResponse.json(
        {
          error: "Invalid candidate approval response payload",
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
        error: "Failed to approve source candidates.",
        details: error instanceof Error ? error.message : "Unknown candidate approval error.",
      },
      { status: 500 },
    )
  }
}
