// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { NextResponse } from "next/server"

import { buildFallbackAssistantContextData, loadAssistantRuntimeContext } from "@/lib/assistant/context"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import {
  getMissingUserCalendarsTableHint,
  isMissingUserCalendarsTableError,
} from "@/lib/tasks-calendar"
import { assistantContextResponseSchema } from "@/schemas/assistant"

export async function GET() {
  try {
    const { user } = await requireAuthenticatedUser()
    const supabase = createSupabaseAdminClient()
    const runtime = await loadAssistantRuntimeContext(supabase, user.id)

    const payload = assistantContextResponseSchema.parse({
      ok: true,
      context: runtime.context,
    })

    return NextResponse.json(payload)
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Authentication required.",
        },
        { status: 401 },
      )
    }

    if (isMissingUserCalendarsTableError(error)) {
      return NextResponse.json(
        assistantContextResponseSchema.parse({
          ok: true,
          context: buildFallbackAssistantContextData(),
          error: getMissingUserCalendarsTableHint(),
        }),
      )
    }

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to load assistant context.",
      },
      { status: 500 },
    )
  }
}

// ##### END BACKEND #####
