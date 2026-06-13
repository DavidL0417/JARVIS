import { NextResponse } from "next/server"

import { mintAppleRemindersToken } from "@/lib/supabase/apple-reminders-tokens"
import { isAuthenticationRequiredError, requireAuthenticatedUser } from "@/lib/supabase/auth"
import { upsertConnectorEnabled } from "@/lib/supabase/connector-settings"

export const runtime = "nodejs"

// Mints (or rotates) the Bearer token the Apple Shortcut uses to push reminders.
// Returns the plaintext token exactly once; only its hash is stored. Authenticated
// as the logged-in Jarvis user.
export async function POST() {
  try {
    const { user } = await requireAuthenticatedUser()
    const token = await mintAppleRemindersToken(user.id)
    // Turn the connector on so the first sync isn't silently skipped.
    await upsertConnectorEnabled({ userId: user.id, connectorId: "apple_reminders", enabled: true })

    return NextResponse.json({ success: true, token })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }
    const message = error instanceof Error ? error.message : "Failed to create Apple Reminders token."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
