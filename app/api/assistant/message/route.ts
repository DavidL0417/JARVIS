// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { NextResponse } from "next/server"

import { buildFallbackAssistantContextData } from "@/lib/assistant/context"
import { runSecretaryTurn } from "@/lib/assistant/secretary"
import { getOrCreateDemoUser } from "@/lib/supabase/demo-user"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
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
        context: buildFallbackAssistantContextData(),
      },
      { status: 400 },
    )
  }

  try {
    const supabase = createSupabaseAdminClient()
    const user = await getOrCreateDemoUser(supabase)
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
    return NextResponse.json(
      {
        ok: false,
        reply: "The secretary hit an error before it could finish that request.",
        toolCalls: [],
        needsRefresh: false,
        clarification: null,
        context: buildFallbackAssistantContextData(),
        error: error instanceof Error ? error.message : "Failed to handle assistant input.",
      },
      { status: 500 },
    )
  }
}

// ##### END BACKEND #####
