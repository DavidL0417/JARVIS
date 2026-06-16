import { NextResponse } from "next/server"

import {
  consolidateMemoriesForUser,
  listUsersWithActiveMemories,
} from "@/lib/assistant/memory-consolidation"
import { getAutomationSettings, isAutomationPaused } from "@/lib/supabase/automation-settings"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

function isAuthorizedCronRequest(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return false
  }
  return request.headers.get("authorization") === `Bearer ${cronSecret}`
}

// Daily near-duplicate consolidation. The Stage-1 unique index already stops
// EXACT dupes; this sweep retires SEMANTIC near-duplicates (different wording,
// same fact) via supersedes_id. Pass ?dryRun=1 to preview proposed merges
// without mutating anything.
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized cron request." }, { status: 401 })
  }

  const url = new URL(request.url)
  const dryRun = url.searchParams.get("dryRun") === "1" || url.searchParams.get("dry_run") === "1"

  const adminClient = createSupabaseAdminClient()
  const userIds = await listUsersWithActiveMemories(adminClient)
  const results = []

  for (const userId of userIds) {
    try {
      // Respect the per-user automation pause — don't mutate memory while paused.
      const settings = await getAutomationSettings(userId, adminClient)
      if (isAutomationPaused(settings)) {
        results.push({ userId, ok: true, skipped: "paused" })
        continue
      }

      const result = await consolidateMemoriesForUser({ adminClient, userId, dryRun })
      results.push({ ok: true, ...result })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown consolidation failure."
      results.push({ userId, ok: false, error: message })
    }
  }

  const superseded = results.reduce((sum, r) => sum + ("superseded" in r ? (r.superseded as number) : 0), 0)

  return NextResponse.json({
    success: true,
    dryRun,
    users: results.length,
    superseded,
    results,
  })
}
