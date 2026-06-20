import { createSupabaseAdminClient } from "@/lib/supabase/server"
import {
  type ImessageOutboxClaimedMessage,
  type ImessageOutboxKind,
} from "@/schemas/imessage-outbox"

// The cloud half of the iMessage outbox control channel. Thin DB wrappers over the
// imessage_outbox queue: enqueue (server → queue), atomic claim + complete (daemon
// round-trip). The send itself happens on the Mac (scripts/imessage/send-daemon.py).
// Mirrors lib/jarvis-note/commands.ts; OPERATOR-ONLY by virtue of the service-role
// admin client + the operator-gated routes that call these.

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

const OUTBOX_TABLE = "imessage_outbox"

type OutboxRow = {
  id: string
  to_handle: string
  body: string
  kind: ImessageOutboxKind
}

function mapClaimedMessage(row: OutboxRow): ImessageOutboxClaimedMessage {
  return {
    id: row.id,
    toHandle: row.to_handle,
    body: row.body,
    kind: row.kind,
  }
}

/**
 * Queue one outbound iMessage. When `dedupKey` is set (e.g. "morning_digest:2026-06-21"
 * in the user's local day), a second enqueue for the same (user, dedupKey) is a no-op —
 * the unique partial index makes scheduled digests safe against Vercel cron drift /
 * double-fire. Returns { id } of the new row, or { id: null, deduped: true } when an
 * existing row already owns that key.
 */
export async function enqueueOutboxMessage(
  adminClient: AdminClient,
  userId: string,
  input: {
    toHandle: string
    body: string
    kind: ImessageOutboxKind
    dedupKey?: string | null
    context?: Record<string, unknown>
  },
): Promise<{ id: string | null; deduped: boolean }> {
  const { data, error } = await adminClient
    .from(OUTBOX_TABLE)
    .insert({
      user_id: userId,
      to_handle: input.toHandle,
      body: input.body,
      kind: input.kind,
      dedup_key: input.dedupKey ?? null,
      context: input.context ?? {},
    })
    .select("id")
    .maybeSingle()

  if (error) {
    // 23505 = unique_violation on the (user_id, dedup_key) partial index: a digest of
    // this kind was already queued for this local day. Treat as success (idempotent).
    if (error.code === "23505") {
      return { id: null, deduped: true }
    }
    throw new Error(error.message)
  }

  return { id: (data?.id as string) ?? null, deduped: false }
}

/**
 * Atomic claim via the FOR UPDATE SKIP LOCKED RPC — never the select-then-update race.
 * Returns null when the queue is empty.
 */
export async function claimNextOutboxMessage(
  adminClient: AdminClient,
  userId: string,
  worker: string,
): Promise<ImessageOutboxClaimedMessage | null> {
  const { data, error } = await adminClient.rpc("claim_next_imessage_outbox_command", {
    p_user_id: userId,
    p_worker: worker,
  })
  if (error) {
    throw new Error(error.message)
  }
  if (!data) {
    return null
  }
  // The RPC returns SETOF (an array): [] when empty, one row when claimed. Tolerate a
  // bare object too, and guard on a real id so an all-null composite is not a message.
  const row = (Array.isArray(data) ? data[0] : data) as OutboxRow | undefined
  return row && row.id ? mapClaimedMessage(row) : null
}

/**
 * Report a claimed message sent/failed. Guarded on status='claimed' so a stale or
 * duplicate report is a no-op (updated:false) rather than clobbering a later state.
 */
export async function completeOutboxMessage(
  adminClient: AdminClient,
  userId: string,
  input: { messageId: string; status: "sent" | "failed"; result?: unknown; error?: string },
): Promise<{ updated: boolean }> {
  const { data, error } = await adminClient
    .from(OUTBOX_TABLE)
    .update({
      status: input.status,
      sent_at: input.status === "sent" ? new Date().toISOString() : null,
      result: input.result ?? null,
      error: input.error ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.messageId)
    .eq("user_id", userId)
    .eq("status", "claimed")
    .select("id")
    .maybeSingle()
  if (error) {
    throw new Error(error.message)
  }
  return { updated: Boolean(data) }
}
