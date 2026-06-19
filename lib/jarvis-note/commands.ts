import { randomBytes } from "node:crypto"

import { createSupabaseAdminClient } from "@/lib/supabase/server"
import {
  jarvisNoteAppendPayloadSchema,
  jarvisNoteConfirmPayloadSchema,
  jarvisNoteDeleteLinesPayloadSchema,
  type JarvisNoteClaimedCommand,
  type JarvisNoteCommandKind,
} from "@/schemas/jarvis-note"
import type { RaycastItemPayload } from "@/schemas/raycast"

// The cloud half of the JARVIS-note daemon control channel. Thin DB wrappers over
// the jarvis_note_commands queue + jarvis_note_captures log, plus the pure helpers
// (ack-token mint/extract, confirm rendering, payload validation) that carry the
// daemon contract. See docs/decisions/jarvis-note-daemon.md.

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

const COMMANDS_TABLE = "jarvis_note_commands"
const CAPTURES_TABLE = "jarvis_note_captures"

// A confirm checkbox embeds "(#<8 hex>)" so a tick maps back to its command row.
const ACK_TOKEN_RE = /\(#([0-9a-f]{8})\)/g

export function mintAckToken(): string {
  return randomBytes(4).toString("hex") // 8 hex chars
}

// The exact confirm-line TEXT (icon-tagged, WITHOUT the "- [ ]" checkbox structure
// the daemon adds). The daemon mirrors this template when it renders the checkbox —
// keep the two in sync (it is the handshake contract).
export function renderConfirmText(action: string, ackToken: string): string {
  return `⚠️ Confirm: ${action.trim()}? (#${ackToken})`
}

// Pull ack tokens out of ticked (checked) task lines in a capture. Defense in depth:
// the daemon also reports ackedTokens directly, but re-deriving here means a daemon
// that forgets to send them still acks correctly.
export function extractAckTokens(
  items: Pick<RaycastItemPayload, "kind" | "checked" | "text">[],
): string[] {
  const tokens = new Set<string>()
  for (const item of items) {
    if (item.kind !== "task" || item.checked !== true) continue
    for (const match of item.text.matchAll(ACK_TOKEN_RE)) {
      tokens.add(match[1])
    }
  }
  return [...tokens]
}

// Validate a command payload against its kind (throws on mismatch). Pure + testable.
export function validateCommandPayload(
  kind: JarvisNoteCommandKind,
  payload: unknown,
): Record<string, unknown> {
  switch (kind) {
    case "append":
      return jarvisNoteAppendPayloadSchema.parse(payload)
    case "confirm":
      return jarvisNoteConfirmPayloadSchema.parse(payload)
    case "delete_lines":
      return jarvisNoteDeleteLinesPayloadSchema.parse(payload)
  }
}

type CommandRow = {
  id: string
  kind: JarvisNoteCommandKind
  payload: Record<string, unknown> | null
  requires_ack: boolean | null
  ack_token: string | null
}

export function mapClaimedCommand(row: CommandRow): JarvisNoteClaimedCommand {
  return {
    id: row.id,
    kind: row.kind,
    payload: row.payload ?? {},
    requiresAck: row.requires_ack ?? false,
    ackToken: row.ack_token ?? null,
  }
}

export async function enqueueCommand(
  adminClient: AdminClient,
  userId: string,
  input: {
    kind: JarvisNoteCommandKind
    payload: Record<string, unknown>
    requiresAck?: boolean
    ackToken?: string | null
  },
): Promise<{ id: string }> {
  validateCommandPayload(input.kind, input.payload)
  const { data, error } = await adminClient
    .from(COMMANDS_TABLE)
    .insert({
      user_id: userId,
      kind: input.kind,
      payload: input.payload,
      requires_ack: input.requiresAck ?? false,
      ack_token: input.ackToken ?? null,
    })
    .select("id")
    .single()
  if (error) {
    throw new Error(error.message)
  }
  return { id: data.id as string }
}

// Convenience: enqueue a confirm with a freshly minted ack token + rendered text.
export async function enqueueConfirm(
  adminClient: AdminClient,
  userId: string,
  action: string,
): Promise<{ id: string; ackToken: string; confirmText: string }> {
  const ackToken = mintAckToken()
  const confirmText = renderConfirmText(action, ackToken)
  const { id } = await enqueueCommand(adminClient, userId, {
    kind: "confirm",
    payload: { action, confirmText },
    requiresAck: true,
    ackToken,
  })
  return { id, ackToken, confirmText }
}

// Atomic claim via the FOR UPDATE SKIP LOCKED RPC — never the select-then-update
// race. Returns null when the queue is empty.
export async function claimNextCommand(
  adminClient: AdminClient,
  userId: string,
  worker: string,
): Promise<JarvisNoteClaimedCommand | null> {
  const { data, error } = await adminClient.rpc("claim_next_jarvis_note_command", {
    p_user_id: userId,
    p_worker: worker,
  })
  if (error) {
    throw new Error(error.message)
  }
  if (!data) {
    return null
  }
  // The RPC returns the composite row; tolerate either a single object or a 1-array.
  const row = (Array.isArray(data) ? data[0] : data) as CommandRow | undefined
  return row ? mapClaimedCommand(row) : null
}

// Report a claimed command done/failed. Guarded on status='claimed' so a stale or
// duplicate report is a no-op (updated:false) rather than clobbering a later state.
export async function completeCommand(
  adminClient: AdminClient,
  userId: string,
  input: { commandId: string; status: "done" | "failed"; result?: unknown; error?: string },
): Promise<{ updated: boolean }> {
  const { data, error } = await adminClient
    .from(COMMANDS_TABLE)
    .update({
      status: input.status,
      completed_at: new Date().toISOString(),
      result: input.result ?? null,
      error: input.error ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.commandId)
    .eq("user_id", userId)
    .eq("status", "claimed")
    .select("id")
    .maybeSingle()
  if (error) {
    throw new Error(error.message)
  }
  return { updated: Boolean(data) }
}

// Record an inbound capture and correlate any newly ticked confirm checkboxes.
// Returns the ack tokens that flipped to acked on THIS capture (idempotent: a token
// already acked yields nothing, so re-sending the same capture is safe).
export async function recordCapture(
  adminClient: AdminClient,
  userId: string,
  capture: {
    noteMarkdown: string
    contentHash: string
    items: RaycastItemPayload[]
    ackedTokens: string[]
    unchanged: boolean
  },
): Promise<{ captureId: string; newlyAcked: string[] }> {
  const tokens = [...new Set([...capture.ackedTokens, ...extractAckTokens(capture.items)])]

  const insertResult = await adminClient
    .from(CAPTURES_TABLE)
    .insert({
      user_id: userId,
      note_markdown: capture.noteMarkdown,
      content_hash: capture.contentHash,
      items: capture.items,
      acked_tokens: tokens,
      unchanged: capture.unchanged,
    })
    .select("id")
    .single()
  if (insertResult.error) {
    throw new Error(insertResult.error.message)
  }

  const newlyAcked: string[] = []
  for (const token of tokens) {
    const { data, error } = await adminClient
      .from(COMMANDS_TABLE)
      .update({ acked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("ack_token", token)
      .eq("requires_ack", true)
      .is("acked_at", null)
      .select("id")
      .maybeSingle()
    if (error) {
      throw new Error(error.message)
    }
    if (data) {
      newlyAcked.push(token)
    }
  }

  return { captureId: insertResult.data.id as string, newlyAcked }
}
