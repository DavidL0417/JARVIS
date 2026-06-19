import { z } from "zod"

// Shape the local Raycast reader (scripts/raycast/push-notes.py) POSTs: a full
// snapshot of the operator's active Raycast Notes plus the checkbox tasks and
// bullets extracted from them. The reader does all the macOS-specific work
// (SQLCipher decrypt via the Keychain key, Raycast's ProseMirror document JSON ->
// markdown, item extraction) so the server receives clean, already-normalized JSON.
// Kept lenient — empty items are filtered server-side rather than rejected here.

// One Raycast note, mirrored as markdown. `id` is Raycast's note UUID and is the
// stable identity used for change detection.
export const raycastNoteSchema = z.object({
  id: z.string().trim().min(1).max(100),
  title: z.string().max(2000).default(""),
  markdown: z.string().max(200000).default(""),
  createdAt: z.string().max(60).nullish(),
  modifiedAt: z.string().max(60).nullish(),
  pinned: z.boolean().default(false),
})

// One extracted line from a note: either a checkbox task or a freeform bullet.
export const raycastItemSchema = z.object({
  // "task" = a checkbox line; "bullet" = a freeform list item / thought.
  kind: z.enum(["task", "bullet"]).default("bullet"),
  // null for bullets; true/false for checked/unchecked tasks.
  checked: z.boolean().nullish(),
  text: z.string().max(4000).default(""),
  // Title of the note this item came from, for grouping in the digest.
  noteTitle: z.string().max(2000).nullish(),
  // Heading path within the note ("For this week: > Course reg"), or null.
  section: z.string().max(2000).nullish(),
  // Provenance: "user" = David's own line; "agent" = a line authored by an
  // assistant on the note board (Scheduler today, JARVIS later), detected by the
  // leading status icon. Defaults to "user" so older readers stay compatible.
  authored: z.enum(["user", "agent"]).default("user"),
})

export const raycastIngestRequestSchema = z.object({
  notes: z.array(raycastNoteSchema).max(500),
  items: z.array(raycastItemSchema).max(5000).default([]),
})

export type RaycastNotePayload = z.infer<typeof raycastNoteSchema>
export type RaycastItemPayload = z.infer<typeof raycastItemSchema>
export type RaycastIngestRequest = z.infer<typeof raycastIngestRequestSchema>
