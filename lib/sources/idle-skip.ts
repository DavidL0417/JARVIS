import { createHash } from "node:crypto"

import { createSupabaseAdminClient } from "@/lib/supabase/server"
import type { SourceKind } from "@/types"

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

/**
 * Idle short-circuit for LLM-backed source refreshes.
 *
 * Fetching upstream content is cheap; extraction (the Claude call) is
 * not. Before extracting, we hash the normalized raw payload and compare it to
 * the hash stored on the most recent non-failed snapshot for that source. If
 * nothing changed upstream, we skip extraction entirely and record a fresh
 * snapshot noting the skip. Calendar mirroring (no LLM cost) never uses this.
 */
export function hashSourceContent(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

export async function getLatestContentHash(
  adminClient: AdminClient,
  userId: string,
  source: SourceKind,
): Promise<string | null> {
  const { data, error } = await adminClient
    .from("source_snapshots")
    .select("payload")
    .eq("user_id", userId)
    .eq("source", source)
    .neq("freshness", "failed")
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ payload: Record<string, unknown> | null }>()

  if (error) {
    throw new Error(error.message)
  }

  const hash = data?.payload?.contentHash
  return typeof hash === "string" && hash.length > 0 ? hash : null
}
