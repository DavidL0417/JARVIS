import { NextResponse } from "next/server"

import {
  DAILY_PLAN_SELECT,
  getCheckInModeFromCount,
  mapDailyPlanRowToDailyPlan,
  mapMemoryItemRowToSummary,
  mapScheduleEventRowToScheduleEvent,
  mapSourceCandidateRowToCandidate,
  mapSourceFileRowToSummary,
  mapSourceSnapshotRowToSummary,
  mapTaskRowToTask,
  mapUserIntegrationRowToUserIntegration,
  SOURCE_CANDIDATE_SELECT,
  SOURCE_FILE_SELECT,
  MEMORY_ITEM_SELECT,
  SCHEDULE_EVENT_SELECT,
  SOURCE_SNAPSHOT_SELECT,
  TASK_SELECT,
  USER_INTEGRATION_SELECT,
} from "@/lib/data/mappers"
import { GMAIL_READONLY_SCOPE, hasOAuthScope } from "@/lib/google-oauth"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import {
  getStoredGoogleIntegration,
  type StoredGoogleIntegration,
} from "@/lib/supabase/google-calendar-integration"
import { getStoredIntegrationToken } from "@/lib/supabase/integration-tokens"
import { dashboardResponseSchema } from "@/schemas/dashboard"
import type {
  DashboardResponse,
  DailyPlanRow,
  MemoryItemRow,
  ScheduleEventRow,
  SourceCandidateRow,
  SourceFileRow,
  SourceSnapshotRow,
  SourceSnapshotSummary,
  Task,
  TaskRow,
  UserIntegration,
  UserIntegrationRow,
  IntegrationTokenRow,
  SourceConnector,
} from "@/types"

function pickCurrentTask(tasks: Task[]): DashboardResponse["currentTask"] {
  const scheduledTask = tasks.find((task) => task.status === "scheduled")

  if (scheduledTask) {
    return {
      id: scheduledTask.id,
      title: scheduledTask.title,
      status: scheduledTask.status,
    }
  }

  const todoTask = tasks.find((task) => task.status === "todo")

  if (!todoTask) {
    return null
  }

  return {
    id: todoTask.id,
    title: todoTask.title,
    status: todoTask.status,
  }
}

function getIntegration(integrations: UserIntegration[], provider: UserIntegration["provider"]) {
  return integrations.find((integration) => integration.provider === provider) ?? null
}

function getLatestSource(sources: SourceSnapshotSummary[], source: SourceSnapshotSummary["source"]) {
  return sources.find((snapshot) => snapshot.source === source) ?? null
}

function getIntegrationAccount(integration: UserIntegration | null) {
  return integration?.providerAccountEmail || integration?.providerUserId || null
}

function getMissingEnv(names: string[]) {
  return names.filter((name) => !process.env[name])
}

function hasRunnableGoogleToken(integration: StoredGoogleIntegration | null) {
  if (!integration) {
    return false
  }

  const expiresAt = integration.expires_at ? new Date(integration.expires_at).getTime() : null
  const accessTokenIsFresh = Boolean(
    integration.access_token && (!expiresAt || expiresAt > Date.now() + 60_000),
  )

  return accessTokenIsFresh || Boolean(integration.refresh_token)
}

function deriveSourceConnectors(input: {
  integrations: UserIntegration[]
  sources: SourceSnapshotSummary[]
  googleIntegration: StoredGoogleIntegration | null
  notionToken: IntegrationTokenRow | null
}): SourceConnector[] {
  const googleIntegration = getIntegration(input.integrations, "google")
  const notionIntegration = getIntegration(input.integrations, "notion")
  const gmailSource = getLatestSource(input.sources, "gmail")
  const notionSource = getLatestSource(input.sources, "notion")
  const googleAccount = getIntegrationAccount(googleIntegration)
  const notionAccount = getIntegrationAccount(notionIntegration)
  const missingGoogleEnv = getMissingEnv(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"])
  const missingNotionEnv = getMissingEnv(["NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET"])
  const sourceConnectors: SourceConnector[] = []

  if (notionIntegration?.status === "connected" && input.notionToken?.access_token) {
    sourceConnectors.push({
      id: "notion",
      status: "connected",
      account: notionAccount,
      canRun: true,
      detail: `${notionAccount ? `${notionAccount}. ` : ""}Import scans Notion pages shared during authorization.`,
    })
  } else if (missingNotionEnv.length > 0) {
    sourceConnectors.push({
      id: "notion",
      status: "missing_config",
      account: notionAccount,
      canRun: false,
      detail: "This deployment has not configured the Notion connector yet. The app owner must add one Notion public OAuth connection before users can connect a workspace.",
    })
  } else if (notionIntegration?.status === "error" || notionSource?.freshness === "failed") {
    sourceConnectors.push({
      id: "notion",
      status: "failed",
      account: notionAccount,
      canRun: false,
      detail: notionSource?.summary || "Notion authorization failed. Reconnect the workspace.",
    })
  } else {
    sourceConnectors.push({
      id: "notion",
      status: "auth_needed",
      account: notionAccount,
      canRun: false,
      detail: "Authorize a Notion workspace before importing scheduling context.",
    })
  }

  if (missingGoogleEnv.length > 0) {
    sourceConnectors.push({
      id: "gmail",
      status: "missing_config",
      account: googleAccount,
      canRun: false,
      detail: `Google OAuth is not configured for this app. Add ${missingGoogleEnv.join(" and ")} on the server before users can authorize Gmail.`,
    })
  } else if (!googleIntegration || googleIntegration.status === "disconnected") {
    sourceConnectors.push({
      id: "gmail",
      status: "auth_needed",
      account: googleAccount,
      canRun: false,
      detail: "Authorize Google with Gmail read-only access before scanning mail context.",
    })
  } else if (googleIntegration.status === "error") {
    sourceConnectors.push({
      id: "gmail",
      status: "failed",
      account: googleAccount,
      canRun: false,
      detail: gmailSource?.summary || "Google authorization failed. Reconnect Google before scanning Gmail.",
    })
  } else if (googleIntegration.status === "needs_reauth" || !hasRunnableGoogleToken(input.googleIntegration)) {
    sourceConnectors.push({
      id: "gmail",
      status: "auth_needed",
      account: googleAccount,
      canRun: false,
      detail: `${googleAccount ? `${googleAccount}. ` : ""}Reconnect Google; the connected row exists, but the private OAuth token is missing or expired.`,
    })
  } else if (!hasOAuthScope(input.googleIntegration?.scope, GMAIL_READONLY_SCOPE)) {
    sourceConnectors.push({
      id: "gmail",
      status: "auth_needed",
      account: googleAccount,
      canRun: false,
      detail: `${googleAccount ? `${googleAccount}. ` : ""}Reconnect Google once so JARVIS can confirm Gmail read-only scope.`,
    })
  } else if (gmailSource?.freshness === "failed") {
    sourceConnectors.push({
      id: "gmail",
      status: "failed",
      account: googleAccount,
      canRun: true,
      detail: gmailSource.summary,
    })
  } else {
    sourceConnectors.push({
      id: "gmail",
      status: "ready",
      account: googleAccount,
      canRun: true,
      detail: `${googleAccount ? `${googleAccount}. ` : ""}Ready to scan recent mail for planning context, small actions, logistics, and deadlines.`,
    })
  }

  return sourceConnectors
}

export async function GET() {
  try {
    const { adminClient, user } = await requireAuthenticatedUser()

    const [
      tasksResult,
      eventsResult,
      checkinsResult,
      memoryResult,
      sourceResult,
      sourceFileResult,
      sourceCandidateResult,
      integrationResult,
      storedGoogleIntegration,
      storedNotionToken,
      dailyPlanResult,
    ] = await Promise.all([
      adminClient
        .from("tasks")
        .select(TASK_SELECT)
        .eq("user_id", user.id)
        .order("created_at", { ascending: true }),
      adminClient
        .from("schedule_events")
        .select(SCHEDULE_EVENT_SELECT)
        .eq("user_id", user.id)
        .order("starts_at", { ascending: true }),
      adminClient.from("checkins").select("id").eq("user_id", user.id).limit(4),
      adminClient
        .from("memory_items")
        .select(MEMORY_ITEM_SELECT)
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(8),
      adminClient
        .from("source_snapshots")
        .select(SOURCE_SNAPSHOT_SELECT)
        .eq("user_id", user.id)
        .order("captured_at", { ascending: false })
        .limit(8),
      adminClient
        .from("source_files")
        .select(SOURCE_FILE_SELECT)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(8),
      adminClient
        .from("source_candidates")
        .select(SOURCE_CANDIDATE_SELECT)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(12),
      adminClient
        .from("integrations")
        .select(USER_INTEGRATION_SELECT)
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false }),
      getStoredGoogleIntegration(user.id),
      getStoredIntegrationToken(user.id, "notion"),
      adminClient
        .from("daily_plans")
        .select(DAILY_PLAN_SELECT)
        .eq("user_id", user.id)
        .neq("status", "superseded")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<DailyPlanRow>(),
    ])

    if (
      tasksResult.error ||
      eventsResult.error ||
      checkinsResult.error ||
      memoryResult.error ||
      sourceResult.error ||
      sourceFileResult.error ||
      sourceCandidateResult.error ||
      integrationResult.error ||
      dailyPlanResult.error
    ) {
      throw new Error(
        tasksResult.error?.message ||
          eventsResult.error?.message ||
          checkinsResult.error?.message ||
          memoryResult.error?.message ||
          sourceResult.error?.message ||
          sourceFileResult.error?.message ||
          sourceCandidateResult.error?.message ||
          integrationResult.error?.message ||
          dailyPlanResult.error?.message ||
          "Failed to load dashboard data from Supabase.",
      )
    }

    const tasks = (tasksResult.data || []).map((row) => mapTaskRowToTask(row as TaskRow))
    const events = (eventsResult.data || [])
      .map((row) => mapScheduleEventRowToScheduleEvent(row as ScheduleEventRow))
      .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime())
    const memories = (memoryResult.data || []).map((row) => mapMemoryItemRowToSummary(row as MemoryItemRow))
    const sources = (sourceResult.data || []).map((row) => mapSourceSnapshotRowToSummary(row as SourceSnapshotRow))
    const sourceFiles = (sourceFileResult.data || []).map((row) => mapSourceFileRowToSummary(row as SourceFileRow))
    const sourceCandidates = (sourceCandidateResult.data || []).map((row) =>
      mapSourceCandidateRowToCandidate(row as SourceCandidateRow),
    )
    const integrations = (integrationResult.data || []).map((row) =>
      mapUserIntegrationRowToUserIntegration(row as UserIntegrationRow),
    )
    const sourceConnectors = deriveSourceConnectors({
      integrations,
      sources,
      googleIntegration: storedGoogleIntegration,
      notionToken: storedNotionToken,
    })
    const dailyPlan = dailyPlanResult.data ? mapDailyPlanRowToDailyPlan(dailyPlanResult.data) : null
    const scheduledTaskIds = new Set(
      (eventsResult.data || [])
        .map((event) => (event as { task_id: string | null }).task_id)
        .filter((taskId): taskId is string => typeof taskId === "string" && taskId.length > 0),
    )

    const overdueCount = tasks.filter((task) => {
      if (task.status === "missed") {
        return true
      }

      if (!task.deadline || task.status === "completed") {
        return false
      }

      return new Date(task.deadline).getTime() < Date.now()
    }).length

    const unscheduledCount = tasks.filter((task) => {
      if (task.status === "completed" || task.status === "missed") {
        return false
      }

      return !task.scheduledFor && !scheduledTaskIds.has(task.id)
    }).length

    const dashboardPayload: DashboardResponse = {
      stats: {
        tasks: tasks.length,
        overdue: overdueCount,
        unscheduled: unscheduledCount,
        checkInMode: getCheckInModeFromCount((checkinsResult.data || []).length),
        memories: memories.length,
        sources: sources.length,
      },
      currentTask: pickCurrentTask(tasks),
      tasks,
      events,
      memories,
      integrations,
      sourceConnectors,
      sources,
      sourceFiles,
      sourceCandidates,
      dailyPlan,
    }

    const parsedPayload = dashboardResponseSchema.safeParse(dashboardPayload)

    if (!parsedPayload.success) {
      return NextResponse.json(
        {
          error: "Invalid dashboard response payload",
          issues: parsedPayload.error.flatten(),
        },
        { status: 500 },
      )
    }

    return NextResponse.json(parsedPayload.data)
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to load dashboard data.",
        details: error instanceof Error ? error.message : "Unknown dashboard error.",
      },
      { status: 500 },
    )
  }
}
