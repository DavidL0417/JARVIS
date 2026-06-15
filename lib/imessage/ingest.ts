import { normalizeHandle } from "@/lib/imessage/handles"
import { upsertImessageMessages, type ArchivedMessageInput } from "@/lib/imessage/store"
import { extractCandidatesFromText } from "@/lib/sources/extraction"
import { getLatestContentHash, hashSourceContent } from "@/lib/sources/idle-skip"
import {
  insertAndAutoApproveSourceCandidates,
  insertSourceSnapshot,
  loadExistingCommitments,
} from "@/lib/sources/persistence"
import type { requireAuthenticatedUser } from "@/lib/supabase/auth"

type AdminClient = Awaited<ReturnType<typeof requireAuthenticatedUser>>["adminClient"]

// Per-message text cap keeps one long text from dominating the extraction prompt.
const MESSAGE_TEXT_CHAR_LIMIT = 1200
// Only the newest N messages feed extraction — the reader may send a large
// backfill on first run, but the prompt stays bounded.
const MAX_MESSAGES_FOR_EXTRACTION = 400

// One message as sent by the local chat.db reader (already decoded/normalized).
export interface IncomingImessage {
  guid: string
  text: string
  handle?: string | null
  senderName?: string | null
  sentAt?: string | null
  isFromMe: boolean
  service?: string | null
  chatName?: string | null
  isGroup?: boolean
}

export interface ImessageIngestResult {
  received: number
  used: number
  archived: number
  candidateCount: number
  extractionSkipped: boolean
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

// Drop messages with no usable text (attachment-only / undecodable reactions) and
// collapse duplicates by GUID, preserving order. A message can join multiple
// chats in chat.db, so the reader may emit the same GUID twice.
export function dedupeMessagesByGuid(messages: IncomingImessage[]): IncomingImessage[] {
  const byGuid = new Map<string, IncomingImessage>()
  for (const message of messages) {
    const guid = normalizeText(message.guid)
    if (!guid || !normalizeText(message.text)) {
      continue
    }
    byGuid.set(guid, message)
  }
  return [...byGuid.values()]
}

function speaker(message: IncomingImessage): string {
  if (message.isFromMe) {
    return "Me"
  }
  return normalizeText(message.senderName) ?? normalizeText(message.handle) ?? "Unknown"
}

// One message rendered for the extractor: direction + who + when + thread + text,
// so the model can distinguish a soft commitment I made ("I'll send it Friday")
// from an inbound ask, and attribute it to the right person/thread.
export function formatMessageLine(message: IncomingImessage): string {
  const when = normalizeText(message.sentAt)
  const thread = normalizeText(message.chatName)
  const text = (normalizeText(message.text) ?? "").slice(0, MESSAGE_TEXT_CHAR_LIMIT)
  return `${when ? `[${when}] ` : ""}${speaker(message)}${thread ? ` (in ${thread})` : ""}: ${text}`
}

// Build the transcript the extractor reads. Most-recent-last so it reads as a
// conversation; capped to the newest MAX_MESSAGES_FOR_EXTRACTION to bound the prompt.
export function buildImessageSourceText(messages: IncomingImessage[]): string {
  return messages.slice(-MAX_MESSAGES_FOR_EXTRACTION).map(formatMessageLine).join("\n")
}

// Map a decoded message to its durable archive row. handleNorm ties a 1:1 thread
// together — the reader sends the counterpart handle for both directions — so the
// assistant can retrieve a whole conversation by a contact's normalized handle.
function toArchiveInput(message: IncomingImessage): ArchivedMessageInput {
  const handle = normalizeText(message.handle)
  return {
    guid: message.guid,
    handle,
    handleNorm: normalizeHandle(handle) || null,
    senderName: normalizeText(message.senderName),
    body: normalizeText(message.text) ?? "",
    sentAt: normalizeText(message.sentAt),
    isFromMe: message.isFromMe,
    service: normalizeText(message.service),
    chatName: normalizeText(message.chatName),
    isGroup: message.isGroup ?? false,
  }
}

// Mirrors the Gmail context scan: dedupe -> archive full text -> idle-skip on content
// hash -> extract scheduler candidates -> snapshot + auto-approve (high-confidence
// only; the rest stay pending for review). The archive step persists every filtered
// message in full so the assistant can read conversations later — extraction alone is
// lossy. One-way and read-only: texts are never written back to Messages.
export async function ingestImessageMessages(
  adminClient: AdminClient,
  userId: string,
  messages: IncomingImessage[],
  options: { archiveOnly?: boolean } = {},
): Promise<ImessageIngestResult> {
  const deduped = dedupeMessagesByGuid(messages)

  if (deduped.length === 0) {
    await insertSourceSnapshot({
      adminClient,
      userId,
      source: "imessage",
      freshness: "fresh",
      summary: "iMessage intake received no messages with usable text.",
      payload: { received: messages.length, used: 0, archived: 0, candidateCount: 0, extractionSkipped: true },
    })
    return { received: messages.length, used: 0, archived: 0, candidateCount: 0, extractionSkipped: true }
  }

  // Archive every filtered message in full (idempotent on guid), independent of the
  // idle-skip below — so re-sent/backfilled windows always land even when extraction
  // is skipped. Returns how many rows were newly stored.
  const archived = await upsertImessageMessages(userId, deduped.map(toArchiveInput), adminClient)

  // Backfill: store history in full but skip extraction (no snapshot, no candidates)
  // so pulling months of messages doesn't flood the queue with stale commitments.
  if (options.archiveOnly) {
    return { received: messages.length, used: deduped.length, archived, candidateCount: 0, extractionSkipped: true }
  }

  const sourceText = buildImessageSourceText(deduped)
  const contentHash = hashSourceContent(sourceText)
  const previousHash = await getLatestContentHash(adminClient, userId, "imessage")

  if (previousHash && previousHash === contentHash) {
    await insertSourceSnapshot({
      adminClient,
      userId,
      source: "imessage",
      freshness: "fresh",
      summary: "iMessage unchanged since last intake; extraction skipped.",
      payload: {
        received: messages.length,
        used: deduped.length,
        archived,
        contentHash,
        candidateCount: 0,
        extractionSkipped: true,
      },
    })
    return { received: messages.length, used: deduped.length, archived, candidateCount: 0, extractionSkipped: true }
  }

  const extraction = await extractCandidatesFromText({
    source: "imessage",
    label: "Recent iMessage / SMS conversations",
    text: sourceText,
    existingCommitments: await loadExistingCommitments(adminClient, userId),
  })

  const sourceSnapshot = await insertSourceSnapshot({
    adminClient,
    userId,
    source: "imessage",
    freshness: "fresh",
    summary: extraction.summary,
    payload: {
      received: messages.length,
      used: deduped.length,
      archived,
      messageCharLimit: MESSAGE_TEXT_CHAR_LIMIT,
      contentHash,
      model: extraction.model,
      candidateCount: extraction.candidates.length,
    },
  })

  const candidates = await insertAndAutoApproveSourceCandidates({
    adminClient,
    userId,
    sourceSnapshotId: sourceSnapshot.id,
    candidates: extraction.candidates,
  })

  return {
    received: messages.length,
    used: deduped.length,
    archived,
    candidateCount: candidates.length,
    extractionSkipped: false,
  }
}
