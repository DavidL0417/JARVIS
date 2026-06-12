import { NextResponse } from "next/server"

import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { getAutomationSettings, isAutomationPaused } from "@/lib/supabase/automation-settings"
import { listRecentAutomationRuns } from "@/lib/automation-runs"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

/**
 * Read-only pause/status probe. Two auth paths:
 *  - Session cookie (the dashboard) → the signed-in operator.
 *  - `Authorization: Bearer ${AUTOMATION_STATUS_TOKEN}` (the local scheduled
 *    tasks) → resolved to the single operator profile, or `?userId=` when given.
 *
 * Intentionally distinct from CRON_SECRET: this is read-only and lower-stakes.
 */
function hasStatusToken(request: Request) {
  const token = process.env.AUTOMATION_STATUS_TOKEN
  if (!token) {
    return false
  }
  return request.headers.get("authorization") === `Bearer ${token}`
}

async function resolveTokenUserId(request: Request): Promise<string | null> {
  const url = new URL(request.url)
  const explicit = url.searchParams.get("userId")
  if (explicit) {
    return explicit
  }

  // Pin the operator when more than one profile exists (test accounts, etc.).
  const owner = process.env.AUTOMATION_OWNER_USER_ID?.trim()
  if (owner) {
    return owner
  }

  const adminClient = createSupabaseAdminClient()
  const { data, error } = await adminClient.from("profiles").select("id").limit(2)
  if (error) {
    throw new Error(error.message)
  }

  // Single-operator deployment: unambiguous. Multi-user requires ?userId=.
  if ((data ?? []).length === 1) {
    return (data?.[0] as { id: string }).id
  }

  return null
}

async function buildStatus(userId: string, adminClient = createSupabaseAdminClient()) {
  const [settings, lastRuns] = await Promise.all([
    getAutomationSettings(userId, adminClient),
    listRecentAutomationRuns({ userId, limit: 20, adminClient }),
  ])

  return {
    paused: isAutomationPaused(settings),
    pausedUntil: settings.pausedUntil,
    pausedReason: settings.pausedReason,
    lastRuns,
  }
}

export async function GET(request: Request) {
  try {
    if (hasStatusToken(request)) {
      const userId = await resolveTokenUserId(request)
      if (!userId) {
        return NextResponse.json(
          { error: "Could not resolve operator. Pass ?userId= for multi-user deployments." },
          { status: 400 },
        )
      }
      return NextResponse.json(await buildStatus(userId))
    }

    const { adminClient, user } = await requireAuthenticatedUser()
    return NextResponse.json(await buildStatus(user.id, adminClient))
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      { error: "Failed to load automation status." },
      { status: 500 },
    )
  }
}
