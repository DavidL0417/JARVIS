import { NextResponse } from "next/server"

import { completeCommand } from "@/lib/jarvis-note/commands"
import { requireRaycastOperator } from "@/lib/raycast/operator-auth"
import { jarvisNoteCompleteRequestSchema } from "@/schemas/jarvis-note"

export const runtime = "nodejs"

// OPERATOR-ONLY, HIDDEN. After the daemon applies a claimed command to the JARVIS
// note (or fails), it reports the outcome here. The update is guarded on
// status='claimed', so a stale or duplicate report is a no-op rather than clobbering
// a later state. Gated by the Raycast operator secret; any other caller gets a 404.
export async function POST(request: Request) {
  const auth = requireRaycastOperator(request)
  if (!auth.ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 })
  }

  const parsed = jarvisNoteCompleteRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request.", issues: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const result = await completeCommand(auth.adminClient, auth.userId, parsed.data)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "JARVIS note complete failed."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
