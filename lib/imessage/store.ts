// Service-role data access for the operator-only iMessage console: the curated
// contact allowlist and the full-message archive. Everything here goes through
// app_private RPCs (see 20260614120000_imessage_operator_console.sql); the tables
// are never exposed to PostgREST. Operator-gating is enforced by callers, not here.

import { normalizeHandle } from "@/lib/imessage/handles"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

export interface ImessageContact {
  id: string
  displayName: string
  handle: string
  handleNorm: string
}

export async function getImessageAllowlist(
  userId: string,
  adminClient: AdminClient = createSupabaseAdminClient(),
): Promise<ImessageContact[]> {
  const { data, error } = await adminClient.rpc("get_imessage_allowlist", { list_user_id: userId })
  if (error) {
    throw new Error(error.message)
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    displayName: String(row.display_name ?? ""),
    handle: String(row.handle ?? ""),
    handleNorm: String(row.handle_norm ?? ""),
  }))
}

export async function addImessageContact(input: {
  userId: string
  displayName: string
  handle: string
  adminClient?: AdminClient
}): Promise<string> {
  const adminClient = input.adminClient ?? createSupabaseAdminClient()
  const { data, error } = await adminClient.rpc("add_imessage_contact", {
    contact_user_id: input.userId,
    contact_display_name: input.displayName.trim(),
    contact_handle: input.handle.trim(),
    contact_handle_norm: normalizeHandle(input.handle),
  })
  if (error) {
    throw new Error(error.message)
  }
  return String(data)
}

export async function removeImessageContact(input: {
  userId: string
  contactId: string
  adminClient?: AdminClient
}): Promise<void> {
  const adminClient = input.adminClient ?? createSupabaseAdminClient()
  const { error } = await adminClient.rpc("remove_imessage_contact", {
    contact_user_id: input.userId,
    contact_id: input.contactId,
  })
  if (error) {
    throw new Error(error.message)
  }
}

// One message as archived. handleNorm ties the whole 1:1 thread together (both
// directions), so retrieving by a contact's handle returns their replies too.
export interface ArchivedMessageInput {
  guid: string
  handle: string | null
  handleNorm: string | null
  senderName: string | null
  body: string
  sentAt: string | null
  isFromMe: boolean
  service: string | null
  chatName: string | null
  isGroup: boolean
}

// Idempotent batch archive. Returns the count of rows that were actually new.
export async function upsertImessageMessages(
  userId: string,
  messages: ArchivedMessageInput[],
  adminClient: AdminClient = createSupabaseAdminClient(),
): Promise<number> {
  if (messages.length === 0) {
    return 0
  }
  const rows = messages.map((message) => ({
    guid: message.guid,
    handle: message.handle,
    handle_norm: message.handleNorm,
    sender_name: message.senderName,
    body: message.body,
    sent_at: message.sentAt,
    is_from_me: message.isFromMe,
    service: message.service,
    chat_name: message.chatName,
    is_group: message.isGroup,
  }))
  const { data, error } = await adminClient.rpc("upsert_imessage_messages", {
    message_user_id: userId,
    message_rows: rows,
  })
  if (error) {
    throw new Error(error.message)
  }
  return typeof data === "number" ? data : 0
}

// A short preview message attached to a suggestion (for number-only contacts).
export interface ImessageSuggestionMessage {
  text: string
  isFromMe: boolean
  sentAt?: string | null
}

// A suggested contact (recent 1:1 not yet allowlisted) the reader uploads for the UI.
export interface ImessageSuggestionInput {
  handle: string
  displayName?: string | null
  lastSeen?: string | null
  messageCount: number
  sentCount: number
  recvCount: number
  recentMessages?: ImessageSuggestionMessage[]
}

export interface ImessageSuggestion extends ImessageSuggestionInput {
  handleNorm: string
  recentMessages: ImessageSuggestionMessage[]
}

// Replace-all: the reader recomputes the suggestion set each run. Returns the count stored.
export async function replaceImessageSuggestions(
  userId: string,
  suggestions: ImessageSuggestionInput[],
  adminClient: AdminClient = createSupabaseAdminClient(),
): Promise<number> {
  const rows = suggestions.map((suggestion) => ({
    handle: suggestion.handle,
    handle_norm: normalizeHandle(suggestion.handle),
    display_name: suggestion.displayName ?? null,
    last_seen: suggestion.lastSeen ?? null,
    message_count: suggestion.messageCount,
    sent_count: suggestion.sentCount,
    recv_count: suggestion.recvCount,
    recent_messages: suggestion.recentMessages ?? [],
  }))
  const { data, error } = await adminClient.rpc("replace_imessage_suggestions", {
    suggestion_user_id: userId,
    suggestion_rows: rows,
  })
  if (error) {
    throw new Error(error.message)
  }
  return typeof data === "number" ? data : 0
}

// Suggestions not yet allowlisted (the RPC filters them out), newest first.
export async function getImessageSuggestions(
  userId: string,
  adminClient: AdminClient = createSupabaseAdminClient(),
): Promise<ImessageSuggestion[]> {
  const { data, error } = await adminClient.rpc("get_imessage_suggestions", { query_user_id: userId })
  if (error) {
    throw new Error(error.message)
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    handle: String(row.handle ?? ""),
    handleNorm: String(row.handle_norm ?? ""),
    displayName: row.display_name === null || row.display_name === undefined ? null : String(row.display_name),
    lastSeen: row.last_seen === null || row.last_seen === undefined ? null : String(row.last_seen),
    messageCount: Number(row.message_count) || 0,
    sentCount: Number(row.sent_count) || 0,
    recvCount: Number(row.recv_count) || 0,
    recentMessages: Array.isArray(row.recent_messages)
      ? (row.recent_messages as Array<Record<string, unknown>>).map((message) => ({
          text: String(message.text ?? ""),
          isFromMe: Boolean(message.isFromMe),
          sentAt: message.sentAt === null || message.sentAt === undefined ? null : String(message.sentAt),
        }))
      : [],
  }))
}

export interface ArchivedMessage {
  handle: string | null
  handleNorm: string | null
  senderName: string | null
  body: string
  sentAt: string | null
  isFromMe: boolean
  chatName: string | null
  isGroup: boolean
}

// Newest-first messages for the given normalized handles (one contact's threads).
// Pass no handles to scan the whole archive, bounded by maxRows.
export async function getImessageMessages(input: {
  userId: string
  handles?: string[] | null
  maxRows?: number
  adminClient?: AdminClient
}): Promise<ArchivedMessage[]> {
  const adminClient = input.adminClient ?? createSupabaseAdminClient()
  const handlesNorm =
    input.handles && input.handles.length > 0
      ? Array.from(new Set(input.handles.map(normalizeHandle).filter(Boolean)))
      : null
  const { data, error } = await adminClient.rpc("get_imessage_messages", {
    query_user_id: input.userId,
    query_handles: handlesNorm,
    max_rows: input.maxRows ?? 200,
  })
  if (error) {
    throw new Error(error.message)
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    handle: row.handle === null || row.handle === undefined ? null : String(row.handle),
    handleNorm: row.handle_norm === null || row.handle_norm === undefined ? null : String(row.handle_norm),
    senderName: row.sender_name === null || row.sender_name === undefined ? null : String(row.sender_name),
    body: String(row.body ?? ""),
    sentAt: row.sent_at === null || row.sent_at === undefined ? null : String(row.sent_at),
    isFromMe: Boolean(row.is_from_me),
    chatName: row.chat_name === null || row.chat_name === undefined ? null : String(row.chat_name),
    isGroup: Boolean(row.is_group),
  }))
}
