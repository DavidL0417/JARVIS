import { NextResponse } from "next/server"

import {
  listUsersForSourceRefresh,
  refreshSourcesForUser,
} from "@/lib/sources/refresh"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

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
    try {
      const result = await refreshSourcesForUser({
        userId,
        mode: "cron",
        adminClient,
      })
      results.push({
        userId,
        ok: true,
        items: result.items,
      })
    } catch (error) {
      results.push({
        userId,
        ok: false,
        error: error instanceof Error ? error.message : "Unknown source-refresh failure.",
      })
    }
  }

  return NextResponse.json({
    success: true,
    refreshedUsers: results.length,
    results,
  })
}
