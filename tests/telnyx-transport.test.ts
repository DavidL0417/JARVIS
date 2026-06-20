import crypto from "node:crypto"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { sendSms, verifyTelnyxSignature } from "@/lib/imessage/transport/telnyx"

describe("verifyTelnyxSignature", () => {
  // A real Ed25519 keypair. Telnyx exposes the public key as base64 of the 32 RAW
  // bytes, which is the SPKI DER minus the 12-byte Ed25519 header.
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  const rawPub = publicKey.export({ format: "der", type: "spki" }).subarray(12)
  const pubB64 = Buffer.from(rawPub).toString("base64")

  const nowMs = 1_700_000_000_000
  const ts = String(Math.floor(nowMs / 1000))
  const body = JSON.stringify({ data: { event_type: "message.received" } })

  const sign = (timestamp: string, payload: string) =>
    crypto.sign(null, Buffer.from(`${timestamp}|${payload}`, "utf8"), privateKey).toString("base64")

  it("accepts a valid signature within tolerance", () => {
    expect(() =>
      verifyTelnyxSignature({ rawBody: body, signatureB64: sign(ts, body), timestamp: ts, publicKeyB64: pubB64, now: nowMs }),
    ).not.toThrow()
  })

  it("rejects a tampered body", () => {
    expect(() =>
      verifyTelnyxSignature({ rawBody: `${body} `, signatureB64: sign(ts, body), timestamp: ts, publicKeyB64: pubB64, now: nowMs }),
    ).toThrow()
  })

  it("rejects a stale timestamp (replay)", () => {
    const oldTs = String(Math.floor(nowMs / 1000) - 1000)
    expect(() =>
      verifyTelnyxSignature({ rawBody: body, signatureB64: sign(oldTs, body), timestamp: oldTs, publicKeyB64: pubB64, now: nowMs }),
    ).toThrow(/stale/i)
  })

  it("rejects missing headers", () => {
    expect(() =>
      verifyTelnyxSignature({ rawBody: body, signatureB64: null, timestamp: ts, publicKeyB64: pubB64, now: nowMs }),
    ).toThrow(/missing/i)
  })

  it("rejects a signature from a different key", () => {
    const other = crypto.generateKeyPairSync("ed25519")
    const badSig = crypto.sign(null, Buffer.from(`${ts}|${body}`, "utf8"), other.privateKey).toString("base64")
    expect(() =>
      verifyTelnyxSignature({ rawBody: body, signatureB64: badSig, timestamp: ts, publicKeyB64: pubB64, now: nowMs }),
    ).toThrow(/verification failed/i)
  })
})

describe("sendSms", () => {
  const realFetch = global.fetch

  beforeEach(() => {
    process.env.TELNYX_API_KEY = "KEYtest"
    process.env.TELNYX_MESSAGING_PROFILE_ID = "mp-1"
    delete process.env.TELNYX_FROM_NUMBER
  })

  afterEach(() => {
    global.fetch = realFetch
    vi.restoreAllMocks()
    delete process.env.TELNYX_API_KEY
    delete process.env.TELNYX_MESSAGING_PROFILE_ID
  })

  it("posts the number-pool body and returns message id + chosen from + status", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              id: "msg-1",
              from: { phone_number: "+15550001111" },
              to: [{ phone_number: "+16469423116", status: "queued" }],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    )
    global.fetch = fetchMock as unknown as typeof fetch

    const out = await sendSms("+16469423116", "hi")
    expect(out).toEqual({ messageId: "msg-1", chosenFrom: "+15550001111", status: "queued" })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://api.telnyx.com/v2/messages")
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer KEYtest")
    const sentBody = JSON.parse(init.body as string)
    expect(sentBody).toMatchObject({ messaging_profile_id: "mp-1", to: "+16469423116", text: "hi", type: "SMS" })
    expect(sentBody.from).toBeUndefined()
  })

  it("throws a useful error string on a Telnyx error response", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ errors: [{ code: "10015", detail: "Number not authorized." }] }), { status: 403 }),
    ) as unknown as typeof fetch
    await expect(sendSms("+16469423116", "hi")).rejects.toThrow(/Telnyx send failed \(403\).*Number not authorized/)
  })

  it("throws when unconfigured", async () => {
    delete process.env.TELNYX_API_KEY
    await expect(sendSms("+16469423116", "hi")).rejects.toThrow(/not configured/i)
  })
})
