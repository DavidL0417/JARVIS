import { NextResponse } from "next/server"

import { inferDeadlinesForUser } from "@/lib/assistant/infer-deadlines"
import { listUsersForSourceRefresh } from "@/lib/sources/refresh"
import { getAutomationSettings, isAutomationPaused } from "@/lib/supabase/automation-settings"
import { recordAutomationRun } from "@/lib/automation-runs"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

function isAuthorizedCronRequest(request: Request) {
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    return false
  }

  return request.headers.get("authorization") === `Bearer ${cronSecret}`
}

// The daily pass that keeps inferred deadlines current — an anchor (a trip, an
// event) may be added long after an undated task was created. Mirrors the
// source-refresh cron: CRON_SECRET-gated, per-user, pause-aware, audited.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized cron request." }, { status: 401 })
  }

  const adminClient = createSupabaseAdminClient()
  const userIds = await listUsersForSourceRefresh(adminClient)
  const results = []

  for (const userId of userIds) {
    const startedAt = new Date().toISOString()

    try {
      const settings = await getAutomationSettings(userId, adminClient)

      if (isAutomationPaused(settings)) {
        await recordAutomationRun({
          userId,
          kind: "deadline_inference",
          status: "skipped_paused",
          summary: settings.pausedUntil ? `Automations paused until ${settings.pausedUntil}.` : "Automations paused.",
          startedAt,
          adminClient,
        })
        results.push({ userId, ok: true, skipped: "paused" })
        continue
      }

      const result = await inferDeadlinesForUser(adminClient, userId)
      await recordAutomationRun({
        userId,
        kind: "deadline_inference",
        status: "completed",
        summary:
          result.considered === 0
            ? "No undated tasks to reason about."
            : `Reviewed ${result.considered} undated task${result.considered === 1 ? "" : "s"}: ${result.suggested} suggested, ${result.retracted} retracted.`,
        payload: { ...result },
        startedAt,
        adminClient,
      })
      results.push({ userId, ok: true, ...result })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown deadline-inference failure."
      await recordAutomationRun({
        userId,
        kind: "deadline_inference",
        status: "failed",
        summary: message,
        startedAt,
        adminClient,
      })
      results.push({ userId, ok: false, error: message })
    }
  }

  return NextResponse.json({ success: true, processedUsers: results.length, results })
}
