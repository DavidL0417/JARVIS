import { requireAuthenticatedUser } from "@/lib/supabase/auth"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

type OperatorSessionResult = { ok: false } | { ok: true; userId: string; adminClient: AdminClient }

// Session-side operator gate for the hidden iMessage console UI. The signed-in user
// must BE the operator (their Supabase id === IMESSAGE_OPERATOR_USER_ID). Every other
// signed-in user — and any deployment that hasn't set the env var — gets ok:false so
// the route answers one indistinguishable 404, mirroring the bearer-gated ingest route
// (lib/imessage/operator-auth.ts). Fails closed on every error.
export async function requireImessageOperatorSession(): Promise<OperatorSessionResult> {
  const operatorUserId = process.env.IMESSAGE_OPERATOR_USER_ID?.trim()
  if (!operatorUserId) {
    return { ok: false }
  }

  try {
    const { user, adminClient } = await requireAuthenticatedUser()
    if (user.id !== operatorUserId) {
      return { ok: false }
    }
    return { ok: true, userId: user.id, adminClient }
  } catch {
    // Not signed in, or an auth-backend hiccup — treat as "not the operator" and 404.
    return { ok: false }
  }
}

// Pure check for the dashboard payload's `isOperator` flag — does this user id match
// the configured operator? False when unset or mismatched. Never throws.
export function isImessageOperator(userId: string | null | undefined): boolean {
  const operatorUserId = process.env.IMESSAGE_OPERATOR_USER_ID?.trim()
  return Boolean(operatorUserId && userId && userId === operatorUserId)
}
