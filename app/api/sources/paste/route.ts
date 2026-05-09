import { NextResponse } from "next/server"

import { extractCandidatesFromText } from "@/lib/sources/extraction"
import { insertSourceCandidates, insertSourceSnapshot } from "@/lib/sources/persistence"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { pasteSourceRequestSchema, sourceIntakeResponseSchema } from "@/schemas/sources"
import type { SourceIntakeResponse } from "@/schemas/sources"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsedBody = pasteSourceRequestSchema.safeParse(body)

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid source paste request",
        issues: parsedBody.error.flatten(),
      },
      { status: 400 },
    )
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const extraction = await extractCandidatesFromText({
      source: parsedBody.data.source,
      sourceRef: parsedBody.data.sourceRef,
      label: parsedBody.data.label,
      text: parsedBody.data.text,
    })
    const sourceSnapshot = await insertSourceSnapshot({
      adminClient,
      userId: user.id,
      source: parsedBody.data.source,
      sourceRef: parsedBody.data.sourceRef ?? parsedBody.data.label,
      freshness: "fresh",
      summary: extraction.summary,
      payload: {
        label: parsedBody.data.label ?? null,
        model: extraction.model,
        textPreview: parsedBody.data.text.slice(0, 2000),
        candidateCount: extraction.candidates.length,
      },
    })
    const candidates = await insertSourceCandidates({
      adminClient,
      userId: user.id,
      sourceSnapshotId: sourceSnapshot.id,
      candidates: extraction.candidates,
    })
    const responsePayload: SourceIntakeResponse = {
      success: true,
      sourceSnapshot,
      sourceFile: null,
      candidates,
    }
    const parsedResponse = sourceIntakeResponseSchema.safeParse(responsePayload)

    if (!parsedResponse.success) {
      return NextResponse.json(
        {
          error: "Invalid source paste response payload",
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
        error: "Failed to extract pasted source.",
        details: error instanceof Error ? error.message : "Unknown source extraction error.",
      },
      { status: 500 },
    )
  }
}
