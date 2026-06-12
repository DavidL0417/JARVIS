import { GMAIL_READONLY_SCOPE, hasOAuthScope } from "@/lib/google-oauth"
import { extractCandidatesFromText } from "@/lib/sources/extraction"
import { getLatestContentHash, hashSourceContent } from "@/lib/sources/idle-skip"
import { insertAndAutoApproveSourceCandidates, insertSourceSnapshot, loadExistingCommitments } from "@/lib/sources/persistence"
import {
  getStoredGoogleIntegration,
  getValidGoogleAccessToken,
} from "@/lib/supabase/google-calendar-integration"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import type { SourceIntakeResponse } from "@/schemas/sources"

export const GMAIL_CONTEXT_SEARCH_QUERY = [
  "newer_than:21d",
  "-category:promotions",
  "-category:social",
  "(to:me OR cc:me OR deadline OR due OR assignment OR syllabus OR exam OR quiz OR project OR meeting OR rescheduled OR RSVP OR confirm OR \"action required\" OR logistics OR application OR apply OR submit OR opportunity OR internship OR research OR \"research assistant\" OR fellowship OR scholarship)",
].join(" ")
export const GMAIL_LATEST_CONTEXT_QUERY = [
  "newer_than:21d",
  "-category:promotions",
  "-category:social",
].join(" ")

const GMAIL_LATEST_MESSAGE_LIMIT = 20
const GMAIL_KEYWORD_MESSAGE_LIMIT = 30
const GMAIL_MESSAGE_BODY_CHAR_LIMIT = 1_600

interface GmailListResponse {
  messages?: Array<{ id?: string }>
  error?: { message?: string }
}

interface GmailMessagePart {
  mimeType?: string
  body?: {
    data?: string
  }
  parts?: GmailMessagePart[]
}

interface GmailMessageResponse {
  id?: string
  snippet?: string
  payload?: GmailMessagePart & {
    headers?: Array<{ name?: string; value?: string }>
  }
  error?: { message?: string }
}

interface GmailMessageSelection {
  id: string
  lanes: Set<"latest" | "keyword">
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  return Buffer.from(normalized, "base64").toString("utf8")
}

function collectTextParts(part: GmailMessagePart | undefined): string[] {
  if (!part) {
    return []
  }

  const ownText =
    part.mimeType === "text/plain" && part.body?.data
      ? [decodeBase64Url(part.body.data)]
      : []

  return [...ownText, ...(part.parts || []).flatMap(collectTextParts)]
}

function getHeader(message: GmailMessageResponse, headerName: string) {
  return message.payload?.headers?.find((header) => header.name?.toLowerCase() === headerName.toLowerCase())?.value ?? null
}

function isGmailApiDisabledMessage(message: string) {
  return /gmail api has not been used|gmail\.googleapis\.com|api has not been used|it is disabled/i.test(message)
}

async function fetchGmailJson<T>(accessToken: string, url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  })
  const payload = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null

  if (!response.ok || !payload) {
    const message = payload?.error?.message || `Gmail API failed with status ${response.status}.`

    if (response.status === 403 && isGmailApiDisabledMessage(message)) {
      throw new Error(`GMAIL_API_DISABLED: ${message}`)
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(`GMAIL_REAUTH_REQUIRED: ${message} Reconnect Google so JARVIS can request Gmail read-only access.`)
    }

    throw new Error(message)
  }

  return payload
}

async function listGmailMessageIds(accessToken: string, query: string, maxResults: number) {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`
  const payload = await fetchGmailJson<GmailListResponse>(accessToken, url)

  return (payload.messages || [])
    .map((message) => message.id)
    .filter((id): id is string => Boolean(id))
}

function mergeMessageSelections(input: Array<{ ids: string[]; lane: "latest" | "keyword" }>) {
  const selections = new Map<string, GmailMessageSelection>()

  for (const group of input) {
    for (const id of group.ids) {
      const existing = selections.get(id)

      if (existing) {
        existing.lanes.add(group.lane)
      } else {
        selections.set(id, {
          id,
          lanes: new Set([group.lane]),
        })
      }
    }
  }

  return Array.from(selections.values())
}

export async function refreshGmailForUser(userId: string): Promise<SourceIntakeResponse> {
  const adminClient = createSupabaseAdminClient()
  const integration = await getStoredGoogleIntegration(userId)

  if (!integration) {
    throw new Error("GMAIL_REAUTH_REQUIRED: Authorize Google with Gmail read-only access before scanning Gmail.")
  }

  if (!hasOAuthScope(integration.scope, GMAIL_READONLY_SCOPE)) {
    throw new Error("GMAIL_REAUTH_REQUIRED: Google must be reconnected with Gmail read-only access before scanning Gmail.")
  }

  const accessToken = await getValidGoogleAccessToken(userId)

  if (!accessToken) {
    throw new Error("GMAIL_REAUTH_REQUIRED: Google is not connected or needs reauthorization.")
  }

  const [latestMessageIds, keywordMessageIds] = await Promise.all([
    listGmailMessageIds(accessToken, GMAIL_LATEST_CONTEXT_QUERY, GMAIL_LATEST_MESSAGE_LIMIT),
    listGmailMessageIds(accessToken, GMAIL_CONTEXT_SEARCH_QUERY, GMAIL_KEYWORD_MESSAGE_LIMIT),
  ])
  const selectedMessages = mergeMessageSelections([
    { ids: latestMessageIds, lane: "latest" },
    { ids: keywordMessageIds, lane: "keyword" },
  ])
  const messageIds = selectedMessages.map((message) => message.id)

  if (messageIds.length === 0) {
    const sourceSnapshot = await insertSourceSnapshot({
      adminClient,
      userId,
      source: "gmail",
      sourceRef: GMAIL_CONTEXT_SEARCH_QUERY,
      freshness: "fresh",
      summary: "Gmail context scan completed; no recent messages matched the latest or keyword queries.",
      payload: {
        latestQuery: GMAIL_LATEST_CONTEXT_QUERY,
        keywordQuery: GMAIL_CONTEXT_SEARCH_QUERY,
        messageCount: 0,
        latestMessageCount: 0,
        keywordMessageCount: 0,
      },
    })

    return {
      success: true,
      sourceSnapshot,
      sourceFile: null,
      candidates: [],
    }
  }

  const messages = await Promise.all(
    messageIds.map((id) =>
      fetchGmailJson<GmailMessageResponse>(
        accessToken,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
      ),
    ),
  )
  const sourceText = messages
    .map((message, index) => {
      const selection = selectedMessages[index]
      const subject = getHeader(message, "Subject") ?? "(no subject)"
      const from = getHeader(message, "From") ?? "(unknown sender)"
      const date = getHeader(message, "Date") ?? "(unknown date)"
      const bodyText = collectTextParts(message.payload).join("\n").slice(0, GMAIL_MESSAGE_BODY_CHAR_LIMIT)

      return [
        `Message ${index + 1}`,
        `ID: ${message.id ?? selection?.id ?? messageIds[index]}`,
        selection ? `Scan lanes: ${Array.from(selection.lanes).join(", ")}` : null,
        `From: ${from}`,
        `Date: ${date}`,
        `Subject: ${subject}`,
        `Snippet: ${message.snippet ?? ""}`,
        bodyText ? `Body:\n${bodyText}` : null,
      ]
        .filter((part): part is string => Boolean(part))
        .join("\n")
    })
    .join("\n\n---\n\n")

  const contentHash = hashSourceContent(sourceText)
  const previousHash = await getLatestContentHash(adminClient, userId, "gmail")

  if (previousHash && previousHash === contentHash) {
    const sourceSnapshot = await insertSourceSnapshot({
      adminClient,
      userId,
      source: "gmail",
      sourceRef: GMAIL_CONTEXT_SEARCH_QUERY,
      freshness: "fresh",
      summary: "Gmail unchanged since last scan; extraction skipped.",
      payload: {
        latestQuery: GMAIL_LATEST_CONTEXT_QUERY,
        keywordQuery: GMAIL_CONTEXT_SEARCH_QUERY,
        messageCount: messages.length,
        dedupedMessageCount: messageIds.length,
        contentHash,
        extractionSkipped: true,
      },
    })

    return {
      success: true,
      sourceSnapshot,
      sourceFile: null,
      candidates: [],
    }
  }

  const extraction = await extractCandidatesFromText({
    source: "gmail",
    sourceRef: GMAIL_CONTEXT_SEARCH_QUERY,
    label: "Recent Gmail context scan",
    text: sourceText,
    existingCommitments: await loadExistingCommitments(adminClient, userId),
  })
  const sourceSnapshot = await insertSourceSnapshot({
    adminClient,
    userId,
    source: "gmail",
    sourceRef: GMAIL_CONTEXT_SEARCH_QUERY,
    freshness: "fresh",
    summary: extraction.summary,
    payload: {
      latestQuery: GMAIL_LATEST_CONTEXT_QUERY,
      keywordQuery: GMAIL_CONTEXT_SEARCH_QUERY,
      messageCount: messages.length,
      latestMessageCount: latestMessageIds.length,
      keywordMessageCount: keywordMessageIds.length,
      dedupedMessageCount: messageIds.length,
      messageBodyCharLimit: GMAIL_MESSAGE_BODY_CHAR_LIMIT,
      messageIds,
      messageLanes: selectedMessages.map((message) => ({
        id: message.id,
        lanes: Array.from(message.lanes),
      })),
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
    success: true,
    sourceSnapshot,
    sourceFile: null,
    candidates,
  }
}
