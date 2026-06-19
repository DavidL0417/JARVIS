import { getLatestContentHash, hashSourceContent } from "@/lib/sources/idle-skip"
import { insertSourceSnapshot } from "@/lib/sources/persistence"
import type { RaycastItemPayload, RaycastNotePayload } from "@/schemas/raycast"
import type { requireAuthenticatedUser } from "@/lib/supabase/auth"

type AdminClient = Awaited<ReturnType<typeof requireAuthenticatedUser>>["adminClient"]

// How many open tasks to spell out in the snapshot summary the assistant reads.
// The full set always lives in the snapshot payload; this only bounds the prompt
// line. The rest are summarized as "(+N more)".
const MAX_DIGEST_TASKS = 15
// Per-item truncation in the digest so one long scratchpad line can't dominate.
const ITEM_TEXT_CHAR_LIMIT = 140

export interface RaycastIngestResult {
  notes: number
  // Counts below are David's own lines only; assistant board lines are excluded.
  openTasks: number
  doneTasks: number
  bullets: number
  // Assistant-authored board lines (Scheduler/JARVIS), kept as context, not David's.
  agentLines: number
  // true when the content is byte-identical to the last snapshot (idle-skip):
  // nothing was written.
  skipped: boolean
  snapshotId: string | null
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

// Collapse duplicate notes by Raycast id (keep the last occurrence) and drop
// notes that carry neither a title nor body. A note can in principle arrive twice
// in one payload; identity is the Raycast UUID.
export function dedupeNotesById(notes: RaycastNotePayload[]): RaycastNotePayload[] {
  const byId = new Map<string, RaycastNotePayload>()
  for (const note of notes) {
    const id = normalizeText(note.id)
    if (!id) {
      continue
    }
    if (!normalizeText(note.title) && !normalizeText(note.markdown)) {
      continue
    }
    byId.set(id, note)
  }
  return [...byId.values()]
}

// Keep only items with real text. Tasks without a checkbox state are treated as
// open. The reader already classifies kind/checked; this just filters noise.
export function filterItems(items: RaycastItemPayload[]): RaycastItemPayload[] {
  return items.filter((item) => Boolean(normalizeText(item.text)))
}

function isOpenTask(item: RaycastItemPayload): boolean {
  return item.kind === "task" && item.checked !== true
}

// David's own lines vs assistant-authored board lines (Scheduler today, JARVIS
// later). The reader tags each item by its leading status icon; here we count and
// digest only David's, so a Scheduler check-in never reads as David's scratchpad.
function isUserAuthored(item: RaycastItemPayload): boolean {
  return item.authored !== "agent"
}

function truncate(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, " ").trim()
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean
}

function digestItemLine(item: RaycastItemPayload): string {
  const where = normalizeText(item.noteTitle)
  const suffix = where ? ` [${where}]` : ""
  return `• ${truncate(item.text, ITEM_TEXT_CHAR_LIMIT)}${suffix}`
}

// The one-line-ish summary the assistant surfaces under "Source Status". It must
// carry the useful signal itself — downstream only reads `summary`, not `payload`
// (see lib/assistant/context.ts). So: counts + the most relevant open tasks.
export function buildRaycastDigest(
  notes: RaycastNotePayload[],
  items: RaycastItemPayload[],
): string {
  const userItems = items.filter(isUserAuthored)
  const agentItems = items.filter((item) => !isUserAuthored(item))
  const openTasks = userItems.filter(isOpenTask)
  const doneTasks = userItems.filter((item) => item.kind === "task" && item.checked === true)
  const bullets = userItems.filter((item) => item.kind === "bullet")

  if (notes.length === 0) {
    return "Raycast intake received no active notes."
  }

  const pinned = notes
    .filter((note) => note.pinned)
    .map((note) => normalizeText(note.title))
    .filter((title): title is string => Boolean(title))

  const header = [
    `${notes.length} Raycast note${notes.length === 1 ? "" : "s"} mirrored`,
    pinned.length > 0 ? ` (pinned: ${pinned.join(", ")})` : "",
    `. ${openTasks.length} open scratchpad task${openTasks.length === 1 ? "" : "s"}`,
    `, ${doneTasks.length} done, ${bullets.length} bullet${bullets.length === 1 ? "" : "s"}.`,
    agentItems.length > 0
      ? ` (${agentItems.length} assistant line${agentItems.length === 1 ? "" : "s"} on the board kept as context, not David's.)`
      : "",
  ].join("")

  if (openTasks.length === 0) {
    return header
  }

  const shown = openTasks.slice(0, MAX_DIGEST_TASKS).map(digestItemLine)
  const overflow = openTasks.length - shown.length
  const tail = overflow > 0 ? `\n(+${overflow} more open task${overflow === 1 ? "" : "s"}; full notes in snapshot payload.)` : ""

  return `${header}\nTop open:\n${shown.join("\n")}${tail}`
}

// Stable text fingerprint for idle-skip: note id + modified time + body, sorted by
// id so payload ordering never changes the hash. When this matches the previous
// snapshot, nothing in Raycast changed and we skip writing.
export function buildRaycastContentText(notes: RaycastNotePayload[]): string {
  return [...notes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((note) => `${note.id}\n${note.modifiedAt ?? ""}\n${note.markdown}`)
    .join("\n<<<NOTE>>>\n")
}

// One-way, read-only mirror of the operator's Raycast Notes into a source snapshot
// for context. Unlike Gmail/iMessage this runs NO extraction and creates NO tasks
// or candidates — it is pure scratchpad context the assistant can reference. The
// full notes + items land in the snapshot payload; the digest summary carries the
// signal that surfaces in the assistant prompt.
export async function ingestRaycastSnapshot(
  adminClient: AdminClient,
  userId: string,
  input: { notes: RaycastNotePayload[]; items: RaycastItemPayload[] },
): Promise<RaycastIngestResult> {
  const notes = dedupeNotesById(input.notes)
  const items = filterItems(input.items)

  const userItems = items.filter(isUserAuthored)
  const openTasks = userItems.filter(isOpenTask).length
  const doneTasks = userItems.filter((item) => item.kind === "task" && item.checked === true).length
  const bullets = userItems.filter((item) => item.kind === "bullet").length
  const agentLines = items.length - userItems.length

  const contentHash = hashSourceContent(buildRaycastContentText(notes))
  const previousHash = await getLatestContentHash(adminClient, userId, "raycast")

  // Unchanged since last intake → write nothing. The prior snapshot already
  // represents this exact state; a duplicate would only crowd the recent-sources
  // window. (No archive step to keep current, unlike iMessage.)
  if (previousHash && previousHash === contentHash) {
    return { notes: notes.length, openTasks, doneTasks, bullets, agentLines, skipped: true, snapshotId: null }
  }

  const snapshot = await insertSourceSnapshot({
    adminClient,
    userId,
    source: "raycast",
    freshness: "fresh",
    summary: buildRaycastDigest(notes, items),
    payload: {
      contentHash,
      noteCount: notes.length,
      openTasks,
      doneTasks,
      bullets,
      notes: notes.map((note) => ({
        id: note.id,
        title: note.title,
        markdown: note.markdown,
        createdAt: note.createdAt ?? null,
        modifiedAt: note.modifiedAt ?? null,
        pinned: note.pinned,
      })),
      items: items.map((item) => ({
        kind: item.kind,
        checked: item.checked ?? null,
        text: item.text,
        noteTitle: item.noteTitle ?? null,
        section: item.section ?? null,
        authored: item.authored,
      })),
    },
  })

  return { notes: notes.length, openTasks, doneTasks, bullets, agentLines, skipped: false, snapshotId: snapshot.id }
}
