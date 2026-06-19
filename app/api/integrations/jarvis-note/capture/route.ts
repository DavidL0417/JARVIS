import { NextResponse } from "next/server"

import {
  createJarvisBrainContext,
  getPreviousCaptureUserLines,
  runBrainOnCapture,
  userLinesFromItems,
} from "@/lib/jarvis-note/brain"
import { recordCapture } from "@/lib/jarvis-note/commands"
import { requireRaycastOperator } from "@/lib/raycast/operator-auth"
import { jarvisNoteCaptureRequestSchema } from "@/schemas/jarvis-note"

export const runtime = "nodejs"

// OPERATOR-ONLY, HIDDEN. The local JARVIS-note daemon WAL-reads the Raycast "JARVIS"
// note, diffs vs last-sent, and POSTs the new state here. We log the capture and
// correlate any ticked confirm checkboxes back to their queued commands (the ack
// half of the handshake). NO task extraction — this is the control surface, not a
// second-brain source. Gated by the same RAYCAST_INGEST_SECRET / RAYCAST_OPERATOR_USER_ID
// as the Raycast intake; any other caller gets a 404. See docs/decisions/jarvis-note-daemon.md.
export async function POST(request: Request) {
  const auth = requireRaycastOperator(request)
  if (!auth.ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 })
  }

  const parsed = jarvisNoteCaptureRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request.", issues: parsed.error.flatten() }, { status: 400 })
  }

  try {
    // Baseline for the new-line diff — read BEFORE this capture is inserted.
    const previousUserLines = await getPreviousCaptureUserLines(auth.adminClient, auth.userId)
    const result = await recordCapture(auth.adminClient, auth.userId, parsed.data)

    // Run the brain on the capture (interpret David's new lines + handle acks),
    // best-effort: a brain failure must never fail the capture record itself.
    let brain: unknown = null
    try {
      const ctx = createJarvisBrainContext(auth.adminClient, auth.userId)
      brain = await runBrainOnCapture(ctx, {
        currentUserLines: userLinesFromItems(parsed.data.items),
        previousUserLines,
        ackedTokens: result.newlyAcked,
      })
    } catch (brainError) {
      brain = { error: brainError instanceof Error ? brainError.message : "brain failed" }
    }

    return NextResponse.json({ success: true, ...result, brain })
  } catch (error) {
    const message = error instanceof Error ? error.message : "JARVIS note capture failed."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
