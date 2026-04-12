// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { NextResponse } from "next/server"

import { loadAssistantRuntimeContext } from "@/lib/assistant/context"
import { getOrCreateDemoUser } from "@/lib/supabase/demo-user"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { assistantContextResponseSchema } from "@/schemas/assistant"

export async function GET() {
  try {
    const supabase = createSupabaseAdminClient()
    const user = await getOrCreateDemoUser(supabase)
    const runtime = await loadAssistantRuntimeContext(supabase, user.id)

    const payload = assistantContextResponseSchema.parse({
      ok: true,
      context: runtime.context,
    })

    return NextResponse.json(payload)
  } catch (error) {
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
