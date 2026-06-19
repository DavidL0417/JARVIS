import { NextResponse } from "next/server"

import { claimNextCommand } from "@/lib/jarvis-note/commands"
import { requireRaycastOperator } from "@/lib/raycast/operator-auth"
import { jarvisNotePollRequestSchema } from "@/schemas/jarvis-note"

export const runtime = "nodejs"
// Hold the request open while waiting for a command. Kept under Vercel's function
// limit; the daemon re-polls immediately on an empty return, so the effective
// latency is ~one DB round-trip when a command is already queued.
export const maxDuration = 30

// Clamp the daemon-requested hold so it can never exceed the platform budget.
const POLL_WAIT_MAX_SECONDS = 25
const POLL_INTERVAL_MS = 1000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// OPERATOR-ONLY, HIDDEN. The local JARVIS-note daemon long-polls here; we atomically
// claim the oldest pending command (FOR UPDATE SKIP LOCKED — never the Canvas
// select-then-update race) and return it. If the queue is empty we hold up to
// waitSeconds, re-checking each second, then return { command: null }. Gated by the
// Raycast operator secret; any other caller gets a 404.
export async function POST(request: Request) {
  const auth = requireRaycastOperator(request)
  if (!auth.ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 })
  }

  const parsed = jarvisNotePollRequestSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request.", issues: parsed.error.flatten() }, { status: 400 })
  }

  const { worker } = parsed.data
  const waitMs = Math.min(parsed.data.waitSeconds ?? POLL_WAIT_MAX_SECONDS, POLL_WAIT_MAX_SECONDS) * 1000
  const deadline = Date.now() + waitMs

  try {
    // Claim immediately on the first pass, then poll until the deadline.
    do {
      const command = await claimNextCommand(auth.adminClient, auth.userId, worker)
      if (command) {
        return NextResponse.json({ success: true, command })
      }
      if (Date.now() >= deadline) {
        break
      }
      await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())))
    } while (Date.now() < deadline)

    return NextResponse.json({ success: true, command: null })
  } catch (error) {
    const message = error instanceof Error ? error.message : "JARVIS note poll failed."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
