import { NextResponse } from "next/server"

import { completeOutboxMessage } from "@/lib/imessage/outbox"
import { requireImessageOperator } from "@/lib/imessage/operator-auth"
import { imessageOutboxCompleteRequestSchema } from "@/schemas/imessage-outbox"

export const runtime = "nodejs"

// OPERATOR-ONLY, HIDDEN. After the daemon sends a claimed message (or fails), it
// reports the outcome here. The update is guarded on status='claimed', so a stale or
// duplicate report is a no-op rather than clobbering a later state. Gated by the
// iMessage operator secret; any other caller gets a 404.
export async function POST(request: Request) {
  const auth = requireImessageOperator(request)
  if (!auth.ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 })
  }

  const parsed = imessageOutboxCompleteRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request.", issues: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const result = await completeOutboxMessage(auth.adminClient, auth.userId, parsed.data)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "iMessage outbox complete failed."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
