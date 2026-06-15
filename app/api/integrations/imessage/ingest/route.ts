import { NextResponse } from "next/server"

import { ingestImessageMessages } from "@/lib/imessage/ingest"
import { requireImessageOperator } from "@/lib/imessage/operator-auth"
import { imessageIngestRequestSchema } from "@/schemas/imessage"

export const runtime = "nodejs"

// OPERATOR-ONLY, HIDDEN intake — not a connector, no UI, no token table. A local
// reader on the operator's Mac (scripts/imessage/read-chat-db.mjs) decodes
// ~/Library/Messages/chat.db and POSTs a batch of recent messages here; they run
// through the same extraction -> candidate pipeline as Gmail. Gated by
// IMESSAGE_INGEST_SECRET + IMESSAGE_OPERATOR_USER_ID; every other caller — and
// every deployment that hasn't set both — gets a 404 indistinguishable from a
// missing route. See docs/decisions/operator-only-imessage.md.
export async function POST(request: Request) {
  const auth = requireImessageOperator(request)
  if (!auth.ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 })
  }

  const parsed = imessageIngestRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request.", issues: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const result = await ingestImessageMessages(auth.adminClient, auth.userId, parsed.data.messages, {
      archiveOnly: parsed.data.archiveOnly,
    })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "iMessage ingest failed."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
