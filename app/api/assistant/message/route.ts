// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { NextResponse } from "next/server"

import { runSecretaryTurn } from "@/lib/assistant/secretary"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { assistantMessageRequestSchema, assistantMessageResponseSchema } from "@/schemas/assistant"

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsedBody = assistantMessageRequestSchema.safeParse(body)

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid assistant message request.",
        reply: "I couldn't read that request.",
        toolCalls: [],
        needsRefresh: false,
        clarification: "Please resend the request in plain language.",
      },
      { status: 400 },
    )
  }

  try {
    const { user } = await requireAuthenticatedUser()
    const supabase = createSupabaseAdminClient()
    const result = await runSecretaryTurn({
      supabase,
      userId: user.id,
      message: parsedBody.data.message,
      now: parsedBody.data.now ?? null,
      timezone: parsedBody.data.timezone ?? null,
      history: parsedBody.data.history,
    })

    return NextResponse.json(assistantMessageResponseSchema.parse(result), {
      status: result.ok ? 200 : 500,
    })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Authentication required.",
          reply: "Please sign in to use JARVIS.",
          toolCalls: [],
          needsRefresh: false,
          clarification: null,
        },
        { status: 401 },
      )
    }

    return NextResponse.json(
      {
        ok: false,
        reply: "The secretary hit an error before it could finish that request.",
        toolCalls: [],
        needsRefresh: false,
        clarification: null,
        error: error instanceof Error ? error.message : "Failed to handle assistant input.",
      },
      { status: 500 },
    )
  }
}

// ##### END BACKEND #####
