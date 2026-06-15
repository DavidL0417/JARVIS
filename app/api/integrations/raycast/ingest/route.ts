import { NextResponse } from "next/server"

import { ingestRaycastSnapshot } from "@/lib/raycast/ingest"
import { requireRaycastOperator } from "@/lib/raycast/operator-auth"
import { raycastIngestRequestSchema } from "@/schemas/raycast"

export const runtime = "nodejs"

// OPERATOR-ONLY, HIDDEN intake — not a connector, no UI, no token table. A local
// reader on the operator's Mac (scripts/raycast/push-notes.py) decrypts Raycast's
// SQLCipher Notes database and POSTs a full snapshot here. Unlike Gmail/iMessage
// this runs NO extraction and creates NO tasks — the notes are mirrored one-way as
// pure source context. Gated by RAYCAST_INGEST_SECRET + RAYCAST_OPERATOR_USER_ID;
// every other caller — and every deployment that hasn't set both — gets a 404
// indistinguishable from a missing route. See docs/decisions/operator-only-raycast.md.
export async function POST(request: Request) {
  const auth = requireRaycastOperator(request)
  if (!auth.ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 })
  }

  const parsed = raycastIngestRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request.", issues: parsed.error.flatten() }, { status: 400 })
  }

  try {
    const result = await ingestRaycastSnapshot(auth.adminClient, auth.userId, parsed.data)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Raycast ingest failed."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
