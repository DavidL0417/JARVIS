import crypto from "node:crypto"

// Telnyx SMS transport — the server-direct sender for proactive digests + replies.
// Send: POST /v2/messages (Bearer key, number-pool via messaging_profile_id). Inbound
// replies + delivery receipts arrive at our webhook route, signed with Ed25519.
// See the Telnyx contract notes captured during the Phase 2 build.

const TELNYX_SEND_URL = "https://api.telnyx.com/v2/messages"

type TelnyxSendResponse = {
  data?: {
    id?: string
    from?: { phone_number?: string }
    to?: Array<{ phone_number?: string; status?: string }>
  }
  errors?: Array<{ code?: string; title?: string; detail?: string }>
}

export interface TelnyxSendResult {
  messageId: string
  chosenFrom: string | null
  status: string | null
}

/**
 * Send one SMS via Telnyx. Uses the number-pool path (messaging_profile_id) by default
 * so the sending number isn't hardcoded; falls back to a fixed TELNYX_FROM_NUMBER if set.
 * A 200 means ACCEPTED/queued, not delivered — final state arrives via the webhook.
 * Throws a useful error string on any non-2xx so the outbox records why it failed.
 */
export async function sendSms(to: string, text: string): Promise<TelnyxSendResult> {
  const apiKey = process.env.TELNYX_API_KEY?.trim()
  const messagingProfileId = process.env.TELNYX_MESSAGING_PROFILE_ID?.trim()
  const fromNumber = process.env.TELNYX_FROM_NUMBER?.trim()

  if (!apiKey || (!messagingProfileId && !fromNumber)) {
    throw new Error("Telnyx is not configured (need TELNYX_API_KEY and TELNYX_MESSAGING_PROFILE_ID or TELNYX_FROM_NUMBER).")
  }

  const body: Record<string, unknown> = { to, text, type: "SMS" }
  if (fromNumber) {
    body.from = fromNumber
  } else {
    body.messaging_profile_id = messagingProfileId
  }

  const res = await fetch(TELNYX_SEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => null)) as TelnyxSendResponse | null

  if (!res.ok) {
    const err = json?.errors?.[0]
    throw new Error(`Telnyx send failed (${res.status}): ${err?.code ?? "?"} ${err?.detail ?? err?.title ?? "unknown error"}`)
  }

  const data = json?.data
  if (!data?.id) {
    throw new Error("Telnyx send returned no message id.")
  }
  return {
    messageId: data.id,
    chosenFrom: data.from?.phone_number ?? null,
    status: (Array.isArray(data.to) ? data.to[0]?.status : null) ?? null,
  }
}

// ── Webhook signature verification (Ed25519) ──────────────────────────────────
// Telnyx signs `${telnyx-timestamp}|${rawBody}` with Ed25519 (NOT HMAC). The Mission
// Control public key is base64 of 32 raw bytes; node:crypto needs SPKI DER, so we
// prepend the 12-byte Ed25519 SPKI header. Verify over the EXACT raw request bytes.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

function buildEd25519Key(publicKeyB64: string) {
  const raw = Buffer.from(publicKeyB64, "base64")
  if (raw.length !== 32) {
    throw new Error(`Telnyx public key must decode to 32 bytes, got ${raw.length}.`)
  }
  const der = Buffer.concat([ED25519_SPKI_PREFIX, raw])
  return crypto.createPublicKey({ key: der, format: "der", type: "spki" })
}

export interface TelnyxVerifyInput {
  rawBody: string
  signatureB64: string | null
  timestamp: string | null
  publicKeyB64: string
  toleranceSeconds?: number
  now?: number
}

/**
 * Verify a Telnyx webhook signature. Throws on any failure (missing headers, stale
 * timestamp beyond tolerance, malformed or invalid signature). `timestamp` is epoch
 * SECONDS. Pass the EXACT raw request body — never a re-serialized object.
 */
export function verifyTelnyxSignature(input: TelnyxVerifyInput): void {
  const tolerance = input.toleranceSeconds ?? 300
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000)

  if (!input.signatureB64 || !input.timestamp) {
    throw new Error("Missing Telnyx signature or timestamp header.")
  }
  const ts = Number.parseInt(input.timestamp, 10)
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > tolerance) {
    throw new Error("Telnyx webhook timestamp is stale or invalid.")
  }
  const signature = Buffer.from(input.signatureB64, "base64")
  if (signature.length !== 64) {
    throw new Error("Telnyx signature must decode to 64 bytes.")
  }
  const signed = Buffer.from(`${input.timestamp}|${input.rawBody}`, "utf8")
  if (!crypto.verify(null, signed, buildEd25519Key(input.publicKeyB64), signature)) {
    throw new Error("Telnyx webhook signature verification failed.")
  }
}
