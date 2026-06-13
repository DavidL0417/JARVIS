import { bearerToken } from "@/lib/supabase/canvas-extension-auth"
import { getAppleRemindersTokenRecord } from "@/lib/supabase/apple-reminders-tokens"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

// Authenticates an incoming Apple Reminders Shortcut request by its Bearer token.
// Mirrors requireCanvasExtensionToken — the token maps to a single user_id.
export async function requireAppleRemindersToken(request: Request) {
  const token = bearerToken(request)

  if (!token) {
    return {
      error: "Apple Reminders token required.",
      status: 401,
      adminClient: null,
      tokenRecord: null,
    } as const
  }

  const tokenRecord = await getAppleRemindersTokenRecord(token)

  if (!tokenRecord || tokenRecord.revoked_at) {
    return {
      error: "Apple Reminders token is invalid or revoked.",
      status: 401,
      adminClient: null,
      tokenRecord: null,
    } as const
  }

  return {
    error: null,
    status: 200,
    adminClient: createSupabaseAdminClient(),
    tokenRecord,
  } as const
}
