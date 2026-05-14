import { GMAIL_READONLY_SCOPE, hasOAuthScope } from "@/lib/google-oauth"
import { extractCandidatesFromText } from "@/lib/sources/extraction"
import { insertSourceCandidates, insertSourceSnapshot } from "@/lib/sources/persistence"
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
  "(to:me OR cc:me OR deadline OR due OR assignment OR syllabus OR exam OR quiz OR project OR meeting OR rescheduled OR RSVP OR confirm OR \"action required\" OR logistics)",
].join(" ")

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

  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=${encodeURIComponent(GMAIL_CONTEXT_SEARCH_QUERY)}`
  const listPayload = await fetchGmailJson<GmailListResponse>(accessToken, listUrl)
  const messageIds = (listPayload.messages || [])
    .map((message) => message.id)
    .filter((id): id is string => Boolean(id))

  if (messageIds.length === 0) {
    const sourceSnapshot = await insertSourceSnapshot({
      adminClient,
      userId,
      source: "gmail",
      sourceRef: GMAIL_CONTEXT_SEARCH_QUERY,
      freshness: "fresh",
      summary: "Gmail context scan completed; no recent direct context messages matched the query.",
      payload: {
        query: GMAIL_CONTEXT_SEARCH_QUERY,
        messageCount: 0,
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
      const subject = getHeader(message, "Subject") ?? "(no subject)"
      const from = getHeader(message, "From") ?? "(unknown sender)"
      const date = getHeader(message, "Date") ?? "(unknown date)"
      const bodyText = collectTextParts(message.payload).join("\n").slice(0, 6000)

      return [
        `Message ${index + 1}`,
        `ID: ${message.id ?? messageIds[index]}`,
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
  const extraction = await extractCandidatesFromText({
    source: "gmail",
    sourceRef: GMAIL_CONTEXT_SEARCH_QUERY,
    label: "Recent Gmail context scan",
    text: sourceText,
  })
  const sourceSnapshot = await insertSourceSnapshot({
    adminClient,
    userId,
    source: "gmail",
    sourceRef: GMAIL_CONTEXT_SEARCH_QUERY,
    freshness: "fresh",
    summary: extraction.summary,
    payload: {
      query: GMAIL_CONTEXT_SEARCH_QUERY,
      messageCount: messages.length,
      messageIds,
      model: extraction.model,
      candidateCount: extraction.candidates.length,
    },
  })
  const candidates = await insertSourceCandidates({
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
