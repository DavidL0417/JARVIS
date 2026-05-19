import { createHash, randomBytes } from "node:crypto"

import { createSupabaseAdminClient } from "@/lib/supabase/server"

const PAIRING_CODE_TTL_MINUTES = 10
const TOKEN_BYTES = 32

export interface CanvasExtensionTokenRecord {
  id: string
  user_id: string
  canvas_origin: string | null
  revoked_at: string | null
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

export function hashCanvasExtensionSecret(value: string) {
  return sha256(value.trim())
}

export function createCanvasExtensionPairingCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const bytes = randomBytes(8)
  let suffix = ""

  for (const byte of bytes) {
    suffix += alphabet[byte % alphabet.length]
  }

  return `JCV-${suffix.slice(0, 4)}-${suffix.slice(4)}`
}

export function createCanvasExtensionToken() {
  return randomBytes(TOKEN_BYTES).toString("base64url")
}

export function canvasExtensionPairingExpiresAt(now = new Date()) {
  const expiresAt = new Date(now)
  expiresAt.setMinutes(expiresAt.getMinutes() + PAIRING_CODE_TTL_MINUTES)
  return expiresAt.toISOString()
}

export async function insertCanvasExtensionPairingCode(input: {
  userId: string
  code: string
  expiresAt: string
}) {
  const adminClient = createSupabaseAdminClient()
  const { error } = await adminClient.rpc("create_canvas_extension_pairing_code", {
    pairing_user_id: input.userId,
    pairing_code_hash: hashCanvasExtensionSecret(input.code),
    pairing_expires_at: input.expiresAt,
  })

  if (error) {
    throw new Error(error.message)
  }
}

export async function consumeCanvasExtensionPairingCode(input: {
  code: string
  canvasOrigin: string | null
}) {
  const adminClient = createSupabaseAdminClient()
  const codeHash = hashCanvasExtensionSecret(input.code)
  const extensionToken = createCanvasExtensionToken()
  const tokenHash = hashCanvasExtensionSecret(extensionToken)
  const { data, error } = await adminClient.rpc("consume_canvas_extension_pairing_code", {
    pairing_code_hash: codeHash,
    extension_token_hash: tokenHash,
    extension_canvas_origin: input.canvasOrigin,
  })

  if (error) {
    throw new Error(error.message)
  }

  if (!Array.isArray(data) || data.length === 0) {
    return null
  }

  return {
    userId: data[0].user_id as string,
    extensionToken,
  }
}

export async function getCanvasExtensionTokenRecord(rawToken: string) {
  const adminClient = createSupabaseAdminClient()
  const { data, error } = await adminClient.rpc("get_canvas_extension_token", {
    extension_token_hash: hashCanvasExtensionSecret(rawToken),
  })

  if (error) {
    throw new Error(error.message)
  }

  if (!Array.isArray(data) || data.length === 0) {
    return null
  }

  return data[0] as CanvasExtensionTokenRecord
}

export async function markCanvasExtensionTokenUsed(input: {
  tokenId: string
  canvasOrigin: string
}) {
  const adminClient = createSupabaseAdminClient()
  const { error } = await adminClient.rpc("mark_canvas_extension_token_used", {
    extension_token_id: input.tokenId,
    extension_canvas_origin: input.canvasOrigin,
  })

  if (error) {
    throw new Error(error.message)
  }
}
