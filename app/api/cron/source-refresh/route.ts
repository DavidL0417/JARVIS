import { NextResponse } from "next/server"

import {
  listUsersForSourceRefresh,
  refreshSourcesForUser,
  type SourceRefreshItem,
} from "@/lib/sources/refresh"
import { getAutomationSettings, isAutomationPaused } from "@/lib/supabase/automation-settings"
import { recordAutomationRun } from "@/lib/automation-runs"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

function summarizeRefreshItems(items: SourceRefreshItem[]) {
  const refreshed = items.filter((item) => item.status === "fresh").length
  const skipped = items.filter((item) => item.status === "skipped").length
  const failed = items.filter((item) => item.status === "failed").length
  const parts = [`Refreshed ${refreshed} source${refreshed === 1 ? "" : "s"}`]
  if (skipped > 0) parts.push(`${skipped} skipped`)
  if (failed > 0) parts.push(`${failed} failed`)
  return `${parts.join(", ")}.`
}

function isAuthorizedCronRequest(request: Request) {
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    return false
  }

  return request.headers.get("authorization") === `Bearer ${cronSecret}`
}

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
          kind: "source_refresh_cron",
          status: "skipped_paused",
          summary: settings.pausedUntil
            ? `Automations paused until ${settings.pausedUntil}.`
            : "Automations paused.",
          startedAt,
          adminClient,
        })
        results.push({ userId, ok: true, skipped: "paused" })
        continue
      }

      const result = await refreshSourcesForUser({
        userId,
        mode: "cron",
        adminClient,
      })
      await recordAutomationRun({
        userId,
        kind: "source_refresh_cron",
        status: "completed",
        summary: summarizeRefreshItems(result.items),
        payload: { items: result.items },
        startedAt,
        adminClient,
      })
      results.push({
        userId,
        ok: true,
        items: result.items,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown source-refresh failure."
      await recordAutomationRun({
        userId,
        kind: "source_refresh_cron",
        status: "failed",
        summary: message,
        startedAt,
        adminClient,
      })
      results.push({
        userId,
        ok: false,
        error: message,
      })
    }
  }

  return NextResponse.json({
    success: true,
    refreshedUsers: results.length,
    results,
  })
}
