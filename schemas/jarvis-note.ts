import { z } from "zod"

import { raycastItemSchema } from "@/schemas/raycast"

// Wire contracts for the JARVIS-note daemon bridge (see lib/jarvis-note/commands.ts
// and docs/decisions/jarvis-note-daemon.md). All three endpoints are operator-only.

// ── Command kinds + per-kind payloads (cloud → Mac) ──────────────────────────
export const jarvisNoteCommandKindSchema = z.enum(["append", "confirm", "delete_lines"])
export type JarvisNoteCommandKind = z.infer<typeof jarvisNoteCommandKindSchema>

// 'append' — add icon-tagged line(s) to the note, verbatim (each must already
// start with a canonical status icon so it reads as agent-authored).
export const jarvisNoteAppendPayloadSchema = z.object({
  lines: z.array(z.string().min(1).max(2000)).min(1).max(20),
})

// 'confirm' — render "- [ ] ⚠️ Confirm: <action>? (#<ackToken>)". The cloud mints
// the ackToken at enqueue time; the daemon renders the line from action + ackToken.
export const jarvisNoteConfirmPayloadSchema = z.object({
  action: z.string().min(1).max(2000),
})

// 'delete_lines' — surgically remove lines whose (trimmed) text matches exactly.
export const jarvisNoteDeleteLinesPayloadSchema = z.object({
  match: z.array(z.string().min(1).max(2000)).min(1).max(20),
})

// ── Capture (Mac → cloud) ────────────────────────────────────────────────────
export const jarvisNoteCaptureRequestSchema = z.object({
  // The JARVIS note's markdown at capture time (WAL-aware read on the Mac).
  noteMarkdown: z.string().max(200_000),
  // Stable hash of the note content for idle-skip / change detection.
  contentHash: z.string().min(1).max(128),
  // David's own lines, parsed by the daemon (agent/icon-tagged lines excluded).
  items: z.array(raycastItemSchema).max(2000).default([]),
  // ack_tokens whose checkbox the operator has ticked as of this capture.
  ackedTokens: z.array(z.string().min(1).max(128)).max(200).default([]),
  // true when byte-identical to the prior capture (nothing new) — recorded, not acted on.
  unchanged: z.boolean().default(false),
})
export type JarvisNoteCaptureRequest = z.infer<typeof jarvisNoteCaptureRequestSchema>

// ── Long-poll request (Mac → cloud) ──────────────────────────────────────────
export const jarvisNotePollRequestSchema = z.object({
  // Opaque worker id (e.g. host + pid) recorded as claimed_by for diagnosability.
  worker: z.string().min(1).max(200).default("jarvis-note-daemon"),
  // How long the endpoint may hold the request waiting for a command, in seconds.
  // Clamped server-side to [POLL_WAIT_MIN, POLL_WAIT_MAX]; kept under Vercel maxDuration.
  waitSeconds: z.number().int().min(0).max(60).optional(),
})
export type JarvisNotePollRequest = z.infer<typeof jarvisNotePollRequestSchema>

// ── Completion report (Mac → cloud) ──────────────────────────────────────────
export const jarvisNoteCompleteRequestSchema = z.object({
  commandId: z.string().uuid(),
  status: z.enum(["done", "failed"]),
  // Free-form daemon result (e.g. { rows: 1, wrote: 2 }) or failure detail.
  result: z.unknown().optional(),
  error: z.string().max(4000).optional(),
})
export type JarvisNoteCompleteRequest = z.infer<typeof jarvisNoteCompleteRequestSchema>

// ── The claimed command handed to the daemon ─────────────────────────────────
// Shape returned by the poll endpoint; the daemon renders/applies it to the note.
export const jarvisNoteClaimedCommandSchema = z.object({
  id: z.string().uuid(),
  kind: jarvisNoteCommandKindSchema,
  payload: z.record(z.unknown()),
  requiresAck: z.boolean(),
  ackToken: z.string().nullable(),
})
export type JarvisNoteClaimedCommand = z.infer<typeof jarvisNoteClaimedCommandSchema>
