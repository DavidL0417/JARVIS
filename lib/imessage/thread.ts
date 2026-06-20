import type { SupabaseClient } from "@supabase/supabase-js"

import type { ImessageThreadContext } from "@/lib/assistant/dialogue"
import { normalizeHandle } from "@/lib/imessage/handles"
import { getImessageAllowlist, getImessageMessages } from "@/lib/imessage/store"

// Resolve a contact query to their archived iMessage thread (oldest-first). Matches
// the allowlist by name (either-direction substring) or by handle. Returns null when
// nothing on the allowlist matches; an empty `messages` array means the contact is
// allowlisted but nothing is archived yet. Shared by the secretary read_messages
// fast-path and the agent loop's read_imessage tool (kept here, not in secretary.ts,
// so the agent executors don't import the secretary brain and create a cycle).
export async function loadImessageThread(
  adminClient: SupabaseClient,
  userId: string,
  contactQuery: string,
): Promise<ImessageThreadContext | null> {
  const query = contactQuery.trim().toLowerCase()
  if (!query) {
    return null
  }

  const contacts = await getImessageAllowlist(userId, adminClient)
  if (contacts.length === 0) {
    return null
  }

  const queryHandleNorm = normalizeHandle(query)
  const matches = contacts.filter((contact) => {
    const name = contact.displayName.toLowerCase()
    const byName = name.includes(query) || query.includes(name)
    const byHandle = Boolean(queryHandleNorm) && contact.handleNorm === queryHandleNorm
    return byName || byHandle
  })
  if (matches.length === 0) {
    return null
  }

  const contactName = matches[0].displayName
  const handleNorms = Array.from(new Set(matches.map((contact) => contact.handleNorm)))
  const archived = await getImessageMessages({ userId, handles: handleNorms, maxRows: 120, adminClient })

  const messages = archived
    .slice()
    .reverse() // store returns newest-first; the dialogue reads oldest-first
    .map((message) => ({
      at: message.sentAt,
      from: message.isFromMe ? "Me" : message.senderName || contactName,
      text: message.body,
    }))

  return { contactName, messages }
}
