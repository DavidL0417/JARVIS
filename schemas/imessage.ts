import { z } from "zod"

// Shape the local chat.db reader (scripts/imessage/read-chat-db.mjs) POSTs: a
// batch of recent messages. The reader does all the macOS-specific work
// (attributedBody decode, Apple-epoch -> ISO, handle resolution) so the server
// receives clean, already-normalized JSON. Kept lenient — empty-text items are
// filtered server-side rather than rejected here.
export const imessageItemSchema = z.object({
  // Stable Messages GUID — the dedupe key. Required.
  guid: z.string().trim().min(1).max(200),
  // Decoded message text. May be empty for attachment-only messages.
  text: z.string().max(20000).default(""),
  // The other party's handle (phone/email). Null for some system messages.
  handle: z.string().max(300).nullish(),
  // Resolved contact name if the reader could map the handle, else null.
  senderName: z.string().max(300).nullish(),
  // ISO 8601 timestamp (UTC) the reader computed from the Apple-epoch date.
  sentAt: z.string().max(60).nullish(),
  // true = sent by the operator, false = received.
  isFromMe: z.boolean().default(false),
  // "iMessage" | "SMS" — passed through from chat.db's service column.
  service: z.string().max(40).nullish(),
  // Group-chat display name, or null for 1:1 threads.
  chatName: z.string().max(300).nullish(),
  // true when the message belongs to a group thread (>1 other participant). The
  // reader computes this from chat membership; the server can't infer it per-message.
  isGroup: z.boolean().default(false),
})

export const imessageIngestRequestSchema = z.object({
  messages: z.array(imessageItemSchema).max(2000),
})

export type ImessageItem = z.infer<typeof imessageItemSchema>
export type ImessageIngestRequest = z.infer<typeof imessageIngestRequestSchema>
