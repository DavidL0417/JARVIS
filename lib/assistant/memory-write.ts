import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js"

// Postgres unique_violation. The memory_items partial unique index
// `memory_items_user_layer_content_key` (user_id, layer, content_norm) where
// status='active' raises this when a write tries to store a fact that already
// exists for the same user + layer. We treat it as an idempotent no-op rather
// than a failure, which is what makes "save the same thing twice = nothing"
// true by construction for every write path.
export const POSTGRES_UNIQUE_VIOLATION = "23505"

export function isMemoryDuplicateError(
  error: Pick<PostgrestError, "code"> | null | undefined,
): boolean {
  return Boolean(error) && error?.code === POSTGRES_UNIQUE_VIOLATION
}

// Read-side TTL. A memory is only visible while unexpired; pair this with
// `.eq("status", "active")` on every memory_items read. Returns a PostgREST
// or-filter meaning `expires_at IS NULL OR expires_at > now`, so notes with a
// passed expiry (e.g. a deadline_context memory whose deadline is gone) drop out
// of the planner, drawer, and schedule reads without needing a sweeper.
export function unexpiredOrFilter(nowIso: string = new Date().toISOString()): string {
  return `expires_at.is.null,expires_at.gt.${nowIso}`
}

export type MemoryInsertOutcome = { id: string | null; deduped: boolean }

/**
 * The single gate every memory_items insert goes through. The database enforces
 * content identity; this helper translates a unique-violation into a clean
 * `deduped` outcome so callers (the remember tool, source promotion, default
 * seeding, ...) don't each have to reimplement — or forget — dedupe.
 *
 * Returns `deduped: true` when the row already existed (no insert happened),
 * otherwise the new row's id. Re-throws any non-duplicate database error.
 */
export async function insertMemoryItem(
  client: SupabaseClient,
  row: Record<string, unknown>,
): Promise<MemoryInsertOutcome> {
  const { data, error } = await client
    .from("memory_items")
    .insert(row)
    .select("id")
    .maybeSingle<{ id: string }>()

  if (error) {
    if (isMemoryDuplicateError(error)) {
      return { id: null, deduped: true }
    }
    throw new Error(error.message)
  }

  return { id: data?.id ?? null, deduped: false }
}
