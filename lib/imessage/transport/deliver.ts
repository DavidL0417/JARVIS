import { claimNextOutboxMessage, completeOutboxMessage } from "@/lib/imessage/outbox"
import { sendSms } from "@/lib/imessage/transport/telnyx"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

export type ImessageTransport = "telnyx" | "mac"

/** The configured outbound transport. Defaults to 'mac' (the Mac send-daemon) so
 * nothing changes until IMESSAGE_TRANSPORT=telnyx is set. */
export function getTransport(): ImessageTransport {
  return process.env.IMESSAGE_TRANSPORT?.trim() === "telnyx" ? "telnyx" : "mac"
}

/**
 * Server-direct delivery of queued outbox rows. For transport 'telnyx', claim each
 * pending row (atomic CAS RPC — so the Mac daemon and Telnyx can never double-send the
 * same row) and send via Telnyx, writing the outcome back through completeOutboxMessage.
 * For 'mac' (default) this is a no-op: the local send-daemon long-polls and delivers.
 * 'sent' here means Telnyx ACCEPTED the message (queued); true delivery is confirmed
 * later by the message.finalized webhook.
 */
export async function deliverPendingOutbox(
  adminClient: AdminClient,
  userId: string,
  opts: { limit?: number } = {},
): Promise<{ transport: ImessageTransport; sent: number; failed: number }> {
  const transport = getTransport()
  if (transport !== "telnyx") {
    return { transport, sent: 0, failed: 0 }
  }

  const limit = opts.limit ?? 10
  let sent = 0
  let failed = 0

  for (let i = 0; i < limit; i += 1) {
    const message = await claimNextOutboxMessage(adminClient, userId, "telnyx-cron")
    if (!message) {
      break
    }
    try {
      const result = await sendSms(message.toHandle, message.body)
      await completeOutboxMessage(adminClient, userId, {
        messageId: message.id,
        status: "sent",
        result: {
          provider: "telnyx",
          providerMsgId: result.messageId,
          chosenFrom: result.chosenFrom,
          telnyxStatus: result.status,
        },
      })
      sent += 1
    } catch (error) {
      await completeOutboxMessage(adminClient, userId, {
        messageId: message.id,
        status: "failed",
        error: error instanceof Error ? error.message : "Telnyx send failed.",
      })
      failed += 1
    }
  }

  return { transport, sent, failed }
}
