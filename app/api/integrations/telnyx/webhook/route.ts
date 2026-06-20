import { NextResponse } from "next/server"

import { normalizeHandle } from "@/lib/imessage/handles"
import { verifyTelnyxSignature } from "@/lib/imessage/transport/telnyx"

export const runtime = "nodejs"

type TelnyxWebhookEvent = {
  data?: {
    event_type?: string
    payload?: {
      id?: string
      text?: string
      received_at?: string
      from?: { phone_number?: string }
      to?: Array<{ phone_number?: string; status?: string }>
    }
  }
}

// OPERATOR-ONLY, HIDDEN. Telnyx POSTs inbound SMS (replies) + delivery receipts here.
// Unconfigured → 404 (indistinguishable, like the other operator routes). We verify the
// Ed25519 signature over the RAW body (read with request.text() BEFORE any JSON parse —
// re-serializing breaks the signature), then act only on inbound messages from the
// operator's own number and ACK everything else fast so Telnyx doesn't retry.
export async function POST(request: Request) {
  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim()
  const operatorUserId = process.env.IMESSAGE_OPERATOR_USER_ID?.trim()
  const operatorHandle = process.env.IMESSAGE_OPERATOR_HANDLE?.trim()
  if (!publicKey || !operatorUserId || !operatorHandle) {
    return NextResponse.json({ error: "Not found." }, { status: 404 })
  }

  // Raw bytes are required for Ed25519 verification — never request.json() first.
  const rawBody = await request.text()
  try {
    verifyTelnyxSignature({
      rawBody,
      signatureB64: request.headers.get("telnyx-signature-ed25519"),
      timestamp: request.headers.get("telnyx-timestamp"),
      publicKeyB64: publicKey,
    })
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 })
  }

  let event: TelnyxWebhookEvent
  try {
    event = JSON.parse(rawBody) as TelnyxWebhookEvent
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 })
  }

  const eventType = event.data?.event_type
  const payload = event.data?.payload

  // Inbound reply from the operator's own number → the reply-loop hook. Anything else
  // (delivery-status events, or a stranger texting the number) is ACKed without action.
  if (eventType === "message.received" && payload) {
    const from = payload.from?.phone_number ?? null
    if (from && normalizeHandle(from) === normalizeHandle(operatorHandle)) {
      // TODO (Phase 2 reply loop / step 4): correlate this reply to the digest's
      // nagged task ids (outbox.context) and route it through the agent to mark the
      // item done, then send a confirmation. For now, record it so it isn't lost.
      console.info(
        `Telnyx inbound reply from operator: ${JSON.stringify({
          providerMsgId: payload.id ?? null,
          text: typeof payload.text === "string" ? payload.text.slice(0, 280) : "",
          receivedAt: payload.received_at ?? null,
        })}`,
      )
    }
  }

  // Always ACK fast (non-2xx triggers Telnyx retries).
  return NextResponse.json({ received: true })
}
