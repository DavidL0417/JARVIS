import { NextResponse } from "next/server"

import { recordAutomationRun } from "@/lib/automation-runs"
import { loadUserTimezone } from "@/lib/data/user-timezone"
import { DIGEST_DEFAULTS } from "@/lib/digest/config"
import { buildMorningDigest } from "@/lib/digest/morning"
import { isDigestDue, localDayKey } from "@/lib/digest/schedule"
import { enqueueOutboxMessage } from "@/lib/imessage/outbox"
import { getAutomationSettings, isAutomationPaused } from "@/lib/supabase/automation-settings"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

export const runtime = "nodejs"
// The morning branch calls buildDailyPlan (reconcile + source refresh + planner
// LLM), which is the slow path; every other tick is a cheap not-due no-op.
export const maxDuration = 300

function isAuthorizedCronRequest(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return false
  }
  return request.headers.get("authorization") === `Bearer ${cronSecret}`
}

// The proactive digest dispatcher. Fires on a fixed UTC cadence (vercel.json) and,
// per the operator's local time, enqueues the morning planner when due. v1 is
// operator-only — only the operator has a deliverable iMessage handle; multi-user
// delivery (per-user handles) is Phase 4. Idempotent per (user, kind, local-day)
// via the outbox dedup key, so Vercel cron drift / overlapping ticks can't double-send.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized cron request." }, { status: 401 })
  }

  const operatorUserId = process.env.IMESSAGE_OPERATOR_USER_ID?.trim()
  const operatorHandle = process.env.IMESSAGE_OPERATOR_HANDLE?.trim()
  if (!operatorUserId || !operatorHandle) {
    return NextResponse.json({ success: true, skipped: "digest not configured (operator id/handle unset)" })
  }

  const adminClient = createSupabaseAdminClient()
  const now = new Date()
  const config = DIGEST_DEFAULTS

  try {
    const timezone = await loadUserTimezone(operatorUserId)
    const settings = await getAutomationSettings(operatorUserId, adminClient)
    const paused = isAutomationPaused(settings, now)

    // Only the morning planner is wired in this step; the evening nag arrives with
    // the evidence + reply layers.
    const morningDue =
      config.morningEnabled &&
      isDigestDue({
        now,
        timeZone: timezone,
        targetHm: config.morningTime,
        maxCatchupMinutes: config.maxCatchupMinutes,
      })

    if (!morningDue) {
      return NextResponse.json({ success: true, due: [], localDay: localDayKey(now, timezone) })
    }

    const kind = "morning_digest" as const
    const dedupKey = `${kind}:${localDayKey(now, timezone)}`
    const startedAt = new Date().toISOString()

    // Catch-up guard: if today's digest is already queued, skip the expensive
    // recompute. The unique dedup index is the hard backstop behind this.
    const existing = await adminClient
      .from("imessage_outbox")
      .select("id")
      .eq("user_id", operatorUserId)
      .eq("dedup_key", dedupKey)
      .maybeSingle()
    if (existing.data) {
      return NextResponse.json({ success: true, kind, skipped: "already-queued-today" })
    }

    if (paused) {
      await recordAutomationRun({
        userId: operatorUserId,
        kind,
        status: "skipped_paused",
        summary: settings.pausedUntil ? `Automations paused until ${settings.pausedUntil}.` : "Automations paused.",
        startedAt,
        adminClient,
      })
      return NextResponse.json({ success: true, kind, skipped: "paused" })
    }

    try {
      const composed = await buildMorningDigest(adminClient, operatorUserId, timezone, now)
      const enqueued = await enqueueOutboxMessage(adminClient, operatorUserId, {
        toHandle: operatorHandle,
        body: composed.text,
        kind,
        dedupKey,
        context: composed.context,
      })
      await recordAutomationRun({
        userId: operatorUserId,
        kind,
        status: "completed",
        summary: enqueued.deduped ? "Morning digest already queued (deduped)." : "Morning digest queued for delivery.",
        payload: { deduped: enqueued.deduped, messageId: enqueued.id },
        startedAt,
        adminClient,
      })
      return NextResponse.json({ success: true, kind, ok: true, deduped: enqueued.deduped, messageId: enqueued.id })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Morning digest composition failed."
      await recordAutomationRun({
        userId: operatorUserId,
        kind,
        status: "failed",
        summary: message,
        startedAt,
        adminClient,
      })
      return NextResponse.json({ success: false, kind, error: message }, { status: 500 })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Digest cron failed."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
