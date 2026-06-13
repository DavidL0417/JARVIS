import { createHash, randomBytes } from "node:crypto"

import { createSupabaseAdminClient } from "@/lib/supabase/server"

const TOKEN_BYTES = 32

export interface AppleRemindersTokenRecord {
  id: string
  user_id: string
  revoked_at: string | null
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

export function hashAppleRemindersToken(value: string) {
  return sha256(value.trim())
}

export function createAppleRemindersToken() {
  return randomBytes(TOKEN_BYTES).toString("base64url")
}

// Mints a fresh token, revoking any prior active token for the user. Returns the
// plaintext token exactly once — only its SHA-256 hash is ever stored.
export async function mintAppleRemindersToken(userId: string, label?: string) {
  const adminClient = createSupabaseAdminClient()
  const token = createAppleRemindersToken()
  const { error } = await adminClient.rpc("mint_apple_reminders_token", {
    token_user_id: userId,
    token_hash: hashAppleRemindersToken(token),
    token_label: label ?? "Apple Reminders Shortcut",
  })

  if (error) {
    throw new Error(error.message)
  }

  return token
}

export async function getAppleRemindersTokenRecord(rawToken: string) {
  const adminClient = createSupabaseAdminClient()
  const { data, error } = await adminClient.rpc("get_apple_reminders_token", {
    lookup_token_hash: hashAppleRemindersToken(rawToken),
  })

  if (error) {
    throw new Error(error.message)
  }

  if (!Array.isArray(data) || data.length === 0) {
    return null
  }

  return data[0] as AppleRemindersTokenRecord
}

// Whether the user has an active (non-revoked) token — drives the connector's
// "connected vs not connected" status in the Sources pane.
export async function userHasAppleRemindersToken(userId: string): Promise<boolean> {
  const adminClient = createSupabaseAdminClient()
  const { data, error } = await adminClient.rpc("user_has_apple_reminders_token", {
    token_user_id: userId,
  })

  if (error) {
    throw new Error(error.message)
  }

  return data === true
}

export async function markAppleRemindersTokenUsed(tokenId: string) {
  const adminClient = createSupabaseAdminClient()
  const { error } = await adminClient.rpc("mark_apple_reminders_token_used", {
    token_id: tokenId,
  })

  if (error) {
    throw new Error(error.message)
  }
}
