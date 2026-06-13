import { NextResponse } from "next/server"

import { coerceRemindersPayload, ingestAppleReminders } from "@/lib/apple-reminders/ingest"
import { requireAppleRemindersToken } from "@/lib/supabase/apple-reminders-auth"
import { markAppleRemindersTokenUsed } from "@/lib/supabase/apple-reminders-tokens"
import { getConnectorSettingsForUser, isConnectorEnabled } from "@/lib/supabase/connector-settings"
import { appleRemindersIngestRequestSchema } from "@/schemas/apple-reminders"

export const runtime = "nodejs"

// Receives a full snapshot of incomplete Apple Reminders from the user's Shortcut
// and mirrors it one-way into tasks. Auth is a per-user Bearer token (not a session).
export async function POST(request: Request) {
  const auth = await requireAppleRemindersToken(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // TEMP DEBUG: read raw text so we can echo the exact bytes the Shortcut sends.
  const rawBody = await request.text()
  const debugRaw = rawBody.slice(0, 1500)

  const parsed = appleRemindersIngestRequestSchema.safeParse(coerceRemindersPayload(rawBody))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", issues: parsed.error.flatten(), debugRaw },
      { status: 400 },
    )
  }

  try {
    const userId = auth.tokenRecord.user_id
    const settings = await getConnectorSettingsForUser(userId, auth.adminClient)
    if (!isConnectorEnabled(settings, "apple_reminders")) {
      return NextResponse.json({ success: true, skipped: true, reason: "Apple Reminders connector is turned off." })
    }

    const result = await ingestAppleReminders(auth.adminClient, userId, parsed.data.reminders)
    await markAppleRemindersTokenUsed(auth.tokenRecord.id)

    return NextResponse.json({ success: true, ...result, debugRaw })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Apple Reminders ingest failed."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
