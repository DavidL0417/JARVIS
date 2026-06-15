import { timingSafeEqual } from "node:crypto"

import { bearerToken } from "@/lib/supabase/canvas-extension-auth"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

// OPERATOR-ONLY, HIDDEN. Raycast Notes intake is not a connector and has no token
// table — it is gated entirely by two env vars only the operator sets:
//   RAYCAST_INGEST_SECRET      — shared secret the local reader sends as a Bearer token
//   RAYCAST_OPERATOR_USER_ID   — the single profile id every ingested snapshot belongs to
// When either is unset, the feature is OFF and the route 404s as if it doesn't
// exist, so it stays invisible in any deployment that hasn't deliberately opted
// in. Mirrors lib/imessage/operator-auth.ts. See docs/decisions/operator-only-raycast.md.

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  // timingSafeEqual throws on length mismatch; compare lengths first (the length
  // itself is not secret) so a wrong-length token can't crash the route.
  if (aBuf.length !== bBuf.length) {
    return false
  }
  return timingSafeEqual(aBuf, bBuf)
}

type OperatorAuthResult =
  | { ok: false }
  | { ok: true; userId: string; adminClient: ReturnType<typeof createSupabaseAdminClient> }

// Returns ok:false for every failure mode (unconfigured, missing token, wrong
// token) so the caller can answer with one indistinguishable 404 — no signal
// that the endpoint exists or that a secret is required.
export function requireRaycastOperator(request: Request): OperatorAuthResult {
  const secret = process.env.RAYCAST_INGEST_SECRET?.trim()
  const operatorUserId = process.env.RAYCAST_OPERATOR_USER_ID?.trim()

  if (!secret || !operatorUserId) {
    return { ok: false }
  }

  const token = bearerToken(request)
  if (!token || !safeEqual(token, secret)) {
    return { ok: false }
  }

  return { ok: true, userId: operatorUserId, adminClient: createSupabaseAdminClient() }
}
