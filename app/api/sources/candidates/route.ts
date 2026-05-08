import { NextResponse } from "next/server"

import {
  mapSourceCandidateRowToCandidate,
  SOURCE_CANDIDATE_SELECT,
} from "@/lib/data/mappers"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import {
  candidateListResponseSchema,
  updateCandidateRequestSchema,
  updateCandidateResponseSchema,
} from "@/schemas/sources"
import type { CandidateListResponse, UpdateCandidateResponse } from "@/schemas/sources"
import type { SourceCandidateRow } from "@/types"

export async function GET() {
  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const { data, error } = await adminClient
      .from("source_candidates")
      .select(SOURCE_CANDIDATE_SELECT)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<SourceCandidateRow[]>()

    if (error) {
      throw new Error(error.message)
    }

    const responsePayload: CandidateListResponse = {
      success: true,
      candidates: (data || []).map(mapSourceCandidateRowToCandidate),
    }
    const parsedResponse = candidateListResponseSchema.safeParse(responsePayload)

    if (!parsedResponse.success) {
      return NextResponse.json(
        {
          error: "Invalid source candidate response payload",
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
        error: "Failed to load source candidates.",
        details: error instanceof Error ? error.message : "Unknown source candidate error.",
      },
      { status: 500 },
    )
  }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null)
  const parsedBody = updateCandidateRequestSchema.safeParse(body)

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid source candidate update request",
        issues: parsedBody.error.flatten(),
      },
      { status: 400 },
    )
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const { data, error } = await adminClient
      .from("source_candidates")
      .update({
        status: parsedBody.data.status,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id)
      .in("id", parsedBody.data.candidateIds)
      .select(SOURCE_CANDIDATE_SELECT)
      .returns<SourceCandidateRow[]>()

    if (error) {
      throw new Error(error.message)
    }

    const responsePayload: UpdateCandidateResponse = {
      success: true,
      candidates: (data || []).map(mapSourceCandidateRowToCandidate),
    }
    const parsedResponse = updateCandidateResponseSchema.safeParse(responsePayload)

    if (!parsedResponse.success) {
      return NextResponse.json(
        {
          error: "Invalid source candidate update response payload",
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
        error: "Failed to update source candidates.",
        details: error instanceof Error ? error.message : "Unknown source candidate update error.",
      },
      { status: 500 },
    )
  }
}
