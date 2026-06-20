import { z } from "zod"

// Wire contracts for the iMessage outbox daemon bridge (see lib/imessage/outbox.ts).
// The local send-daemon long-polls /outbox/poll, sends the claimed message via
// Messages.app, then reports to /outbox/complete. All endpoints are operator-only.

export const imessageOutboxKindSchema = z.enum([
  "morning_digest",
  "evening_digest",
  "reply",
  "manual",
  "test",
])
export type ImessageOutboxKind = z.infer<typeof imessageOutboxKindSchema>

// ── Long-poll request (Mac → cloud) ──────────────────────────────────────────
export const imessageOutboxPollRequestSchema = z.object({
  // Opaque worker id (e.g. host + pid) recorded as claimed_by for diagnosability.
  worker: z.string().min(1).max(200).default("imessage-send-daemon"),
  // How long the endpoint may hold the request waiting for a message, in seconds.
  // Clamped server-side; kept under Vercel maxDuration.
  waitSeconds: z.number().int().min(0).max(60).optional(),
})
export type ImessageOutboxPollRequest = z.infer<typeof imessageOutboxPollRequestSchema>

// ── Completion report (Mac → cloud) ──────────────────────────────────────────
export const imessageOutboxCompleteRequestSchema = z.object({
  messageId: z.string().uuid(),
  status: z.enum(["sent", "failed"]),
  // Free-form daemon result (e.g. { service: "iMessage" }) or failure detail.
  result: z.unknown().optional(),
  error: z.string().max(4000).optional(),
})
export type ImessageOutboxCompleteRequest = z.infer<typeof imessageOutboxCompleteRequestSchema>

// ── The claimed message handed to the daemon ─────────────────────────────────
export const imessageOutboxClaimedMessageSchema = z.object({
  id: z.string().uuid(),
  toHandle: z.string().min(1),
  body: z.string().min(1),
  kind: imessageOutboxKindSchema,
})
export type ImessageOutboxClaimedMessage = z.infer<typeof imessageOutboxClaimedMessageSchema>
