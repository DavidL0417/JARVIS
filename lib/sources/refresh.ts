import { GMAIL_READONLY_SCOPE, GOOGLE_CALENDAR_READONLY_SCOPE, hasOAuthScope } from "@/lib/google-oauth"
import { syncGoogleCalendarEventsForUser } from "@/lib/google-calendar-events"
import { refreshCanvasForUser } from "@/lib/sources/canvas-refresh"
import { GMAIL_CONTEXT_SEARCH_QUERY, refreshGmailForUser } from "@/lib/sources/gmail-refresh"
import { refreshNotionForUser } from "@/lib/sources/notion-refresh"
import { insertSourceSnapshot } from "@/lib/sources/persistence"
import { getStoredCanvasIntegration } from "@/lib/supabase/canvas-integration"
import { getStoredGoogleIntegration } from "@/lib/supabase/google-calendar-integration"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import type { requireAuthenticatedUser } from "@/lib/supabase/auth"
import type { SourceKind } from "@/types"

type AdminClient = Awaited<ReturnType<typeof requireAuthenticatedUser>>["adminClient"]

export type SourceRefreshMode = "cron" | "pre_plan"
export type SourceRefreshStatus = "fresh" | "failed" | "skipped"

export interface SourceRefreshItem {
  source: SourceKind
  status: SourceRefreshStatus
  summary: string
  runnable: boolean
  error?: string
}

export interface SourceRefreshResult {
  userId: string
  mode: SourceRefreshMode
  refreshedAt: string
  items: SourceRefreshItem[]
}

export class SourceRefreshError extends Error {
  result: SourceRefreshResult

  constructor(result: SourceRefreshResult) {
    const failed = result.items
      .filter((item) => item.status === "failed")
      .map((item) => `${item.source}: ${item.error || item.summary}`)
      .join("; ")

    super(`Connected source refresh failed before planning. ${failed}`)
    this.name = "SourceRefreshError"
    this.result = result
  }
}

function stripErrorPrefix(message: string) {
  return message
    .replace("GMAIL_API_DISABLED:", "")
    .replace("GMAIL_REAUTH_REQUIRED:", "")
    .replace("SOURCE_EXTRACTION_FAILED:", "")
    .replace("NOTION_REAUTH_REQUIRED:", "")
    .replace("NOTION_DATABASE_NOT_SELECTED:", "")
    .replace("NOTION_DATABASE_NOT_FOUND:", "")
    .replace("CANVAS_REAUTH_REQUIRED:", "")
    .trim()
}

async function getNotionRunnableConfig(adminClient: AdminClient, userId: string) {
  const { data, error } = await adminClient
    .from("integrations")
    .select("status, selected_source_id, selected_source_name")
    .eq("user_id", userId)
    .eq("provider", "notion")
    .maybeSingle<{
      status: string | null
      selected_source_id: string | null
      selected_source_name: string | null
    }>()

  if (error) {
    throw new Error(error.message)
  }

  return data?.status === "connected" && Boolean(data.selected_source_id)
    ? data
    : null
}

async function recordRefreshFailure(input: {
  adminClient: AdminClient
  userId: string
  source: SourceKind
  sourceRef?: string | null
  summary: string
  reason: string
}) {
  await insertSourceSnapshot({
    adminClient: input.adminClient,
    userId: input.userId,
    source: input.source,
    sourceRef: input.sourceRef ?? null,
    freshness: "failed",
    summary: input.summary,
    payload: {
      reason: input.reason,
    },
  })
}

export async function refreshSourcesForUser(input: {
  userId: string
  mode: SourceRefreshMode
  force?: boolean
  adminClient?: AdminClient
}): Promise<SourceRefreshResult> {
  const adminClient = input.adminClient ?? createSupabaseAdminClient()
  const refreshedAt = new Date().toISOString()
  const items: SourceRefreshItem[] = []

  const googleIntegration = await getStoredGoogleIntegration(input.userId)
  const canvasIntegration = await getStoredCanvasIntegration(input.userId)

  if (googleIntegration?.status === "connected" && hasOAuthScope(googleIntegration.scope, GOOGLE_CALENDAR_READONLY_SCOPE)) {
    const result = await syncGoogleCalendarEventsForUser(input.userId)

    items.push({
      source: "google_calendar",
      status: result.success ? "fresh" : "failed",
      summary: result.success
        ? `Google Calendar refreshed with ${result.events.length} mirrored events.`
        : result.error || "Google Calendar refresh failed.",
      runnable: true,
      error: result.success ? undefined : result.error || "Google Calendar refresh failed.",
    })
  } else {
    items.push({
      source: "google_calendar",
      status: "skipped",
      summary: "Google Calendar is not connected with read access.",
      runnable: false,
    })
  }

  if (googleIntegration?.status === "connected" && hasOAuthScope(googleIntegration.scope, GMAIL_READONLY_SCOPE)) {
    try {
      const result = await refreshGmailForUser(input.userId)
      items.push({
        source: "gmail",
        status: "fresh",
        summary: result.sourceSnapshot.summary,
        runnable: true,
      })
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "Gmail refresh failed."
      const message = stripErrorPrefix(rawMessage)
      await recordRefreshFailure({
        adminClient,
        userId: input.userId,
        source: "gmail",
        sourceRef: GMAIL_CONTEXT_SEARCH_QUERY,
        summary: message,
        reason: rawMessage.startsWith("GMAIL_REAUTH_REQUIRED:")
            ? "reauthorization_required"
            : rawMessage.startsWith("GMAIL_API_DISABLED:")
              ? "gmail_api_disabled"
              : rawMessage.startsWith("SOURCE_EXTRACTION_FAILED:")
                ? "extraction_failed"
                : "refresh_failed",
      })
      items.push({
        source: "gmail",
        status: "failed",
        summary: message,
        runnable: true,
        error: message,
      })
    }
  } else {
    items.push({
      source: "gmail",
      status: "skipped",
      summary: "Gmail is not connected with read access.",
      runnable: false,
    })
  }

  const notionConfig = await getNotionRunnableConfig(adminClient, input.userId)

  if (notionConfig) {
    try {
      const result = await refreshNotionForUser(input.userId)
      items.push({
        source: "notion",
        status: "fresh",
        summary: result.sourceSnapshot.summary,
        runnable: true,
      })
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "Notion refresh failed."
      const message = stripErrorPrefix(rawMessage)
      await recordRefreshFailure({
        adminClient,
        userId: input.userId,
        source: "notion",
        sourceRef: notionConfig.selected_source_id,
        summary: message,
        reason: rawMessage.startsWith("NOTION_REAUTH_REQUIRED:")
          ? "reauthorization_required"
          : rawMessage.startsWith("NOTION_DATABASE_NOT_SELECTED:")
            ? "database_not_selected"
            : rawMessage.startsWith("NOTION_DATABASE_NOT_FOUND:")
              ? "database_not_readable"
              : "refresh_failed",
      })
      items.push({
        source: "notion",
        status: "failed",
        summary: message,
        runnable: true,
        error: message,
      })
    }
  } else {
    items.push({
      source: "notion",
      status: "skipped",
      summary: "Notion is not connected to an authoritative task database.",
      runnable: false,
    })
  }

  if (canvasIntegration?.status === "connected" && canvasIntegration.base_url && canvasIntegration.access_token) {
    try {
      const result = await refreshCanvasForUser(input.userId)
      items.push({
        source: "canvas",
        status: "fresh",
        summary: result.sourceSnapshot.summary,
        runnable: true,
      })
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "Canvas refresh failed."
      const message = stripErrorPrefix(rawMessage)
      await recordRefreshFailure({
        adminClient,
        userId: input.userId,
        source: "canvas",
        sourceRef: canvasIntegration.base_url,
        summary: message,
        reason: rawMessage.startsWith("CANVAS_REAUTH_REQUIRED:")
          ? "reauthorization_required"
          : "refresh_failed",
      })
      items.push({
        source: "canvas",
        status: "failed",
        summary: message,
        runnable: true,
        error: message,
      })
    }
  } else {
    items.push({
      source: "canvas",
      status: "skipped",
      summary: "Canvas is not connected with a base URL and access token.",
      runnable: false,
    })
  }

  const result: SourceRefreshResult = {
    userId: input.userId,
    mode: input.mode,
    refreshedAt,
    items,
  }

  if (input.mode === "pre_plan" && items.some((item) => item.runnable && item.status === "failed")) {
    throw new SourceRefreshError(result)
  }

  return result
}

export async function listUsersForSourceRefresh(adminClient: AdminClient = createSupabaseAdminClient()) {
  const { data, error } = await adminClient
    .from("integrations")
    .select("user_id")
    .eq("status", "connected")

  if (error) {
    throw new Error(error.message)
  }

  return Array.from(new Set((data ?? []).map((row) => row.user_id).filter((userId): userId is string => Boolean(userId))))
}
