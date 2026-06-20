import { GMAIL_READONLY_SCOPE, hasOAuthScope } from "@/lib/google-oauth"
import {
  collectTextParts,
  fetchGmailJson,
  getHeader,
  type GmailMessageResponse,
} from "@/lib/sources/gmail-refresh"
import {
  getStoredGoogleIntegration,
  getValidGoogleAccessToken,
} from "@/lib/supabase/google-calendar-integration"

// Ad-hoc Gmail search for the assistant agent loop. Unlike refreshGmailForUser
// (batch ingestion on two fixed queries → candidate extraction), this answers a
// real-time question — "did my professor email me about the deadline?" — by running
// the agent's own Gmail query and returning the matching messages directly. It does
// NOT extract candidates or write snapshots; it's a pure read so the agent can
// answer from the user's actual inbox. Reuses the token + fetch + parse helpers
// from gmail-refresh so query/auth/body-decoding behavior stays identical.

const GMAIL_SEARCH_BODY_CHAR_LIMIT = 1_200
const GMAIL_SEARCH_DEFAULT_MAX = 8
const GMAIL_SEARCH_HARD_MAX = 15

export interface GmailSearchMessage {
  id: string
  from: string
  to: string
  date: string
  subject: string
  snippet: string
  body: string
}

interface GmailListResponse {
  messages?: Array<{ id?: string }>
  error?: { message?: string }
}

/**
 * Run a Gmail query for the user and return the matching messages (newest-first as
 * Gmail returns them). Throws GMAIL_REAUTH_REQUIRED / GMAIL_API_DISABLED style
 * errors (same as gmail-refresh) so the caller can surface a reconnect hint.
 */
export async function searchGmailForUser(
  userId: string,
  query: string,
  maxResults: number = GMAIL_SEARCH_DEFAULT_MAX,
): Promise<GmailSearchMessage[]> {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return []
  }

  const integration = await getStoredGoogleIntegration(userId)
  if (!integration) {
    throw new Error("GMAIL_REAUTH_REQUIRED: Authorize Google with Gmail read-only access before searching Gmail.")
  }
  if (!hasOAuthScope(integration.scope, GMAIL_READONLY_SCOPE)) {
    throw new Error("GMAIL_REAUTH_REQUIRED: Google must be reconnected with Gmail read-only access before searching Gmail.")
  }

  const accessToken = await getValidGoogleAccessToken(userId)
  if (!accessToken) {
    throw new Error("GMAIL_REAUTH_REQUIRED: Google is not connected or needs reauthorization.")
  }

  const cappedMax = Math.max(1, Math.min(maxResults, GMAIL_SEARCH_HARD_MAX))
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${cappedMax}&q=${encodeURIComponent(trimmedQuery)}`
  const list = await fetchGmailJson<GmailListResponse>(accessToken, listUrl)
  const ids = (list.messages || [])
    .map((message) => message.id)
    .filter((id): id is string => Boolean(id))

  if (ids.length === 0) {
    return []
  }

  const messages = await Promise.all(
    ids.map((id) =>
      fetchGmailJson<GmailMessageResponse>(
        accessToken,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
      ),
    ),
  )

  return messages.map((message, index) => ({
    id: message.id ?? ids[index],
    from: getHeader(message, "From") ?? "(unknown sender)",
    to: getHeader(message, "To") ?? "",
    date: getHeader(message, "Date") ?? "",
    subject: getHeader(message, "Subject") ?? "(no subject)",
    snippet: message.snippet ?? "",
    body: collectTextParts(message.payload).join("\n").slice(0, GMAIL_SEARCH_BODY_CHAR_LIMIT),
  }))
}
