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
import { GMAIL_READONLY_SCOPE, GOOGLE_CALENDAR_READONLY_SCOPE, hasOAuthScope } from "@/lib/google-oauth"
import { isExcludedScheduleEventTitle } from "@/lib/task-calendar-constants"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import {
  getStoredCanvasIntegration,
  type StoredCanvasIntegration,
} from "@/lib/supabase/canvas-integration"
import {
  getStoredCalDavIntegration,
  type StoredCalDavIntegration,
} from "@/lib/supabase/caldav-integration"
import { getConnectorSettingsForUser, isConnectorEnabled } from "@/lib/supabase/connector-settings"
import {
  getStoredGoogleIntegration,
  type StoredGoogleIntegration,
} from "@/lib/supabase/google-calendar-integration"
import { getStoredIntegrationToken } from "@/lib/supabase/integration-tokens"
import { reconcileStaleSchedule } from "@/lib/reconciliation"
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
  SourceConnectorId,
} from "@/types"

type AdminClient = Awaited<ReturnType<typeof requireAuthenticatedUser>>["adminClient"]

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

function getTime(value: string | null | undefined) {
  return value ? new Date(value).getTime() : null
}

function getLatestActiveSource(
  sources: SourceSnapshotSummary[],
  source: SourceSnapshotSummary["source"],
  options: { resolvedAfter?: string | null } = {},
) {
  const resolvedAfter = getTime(options.resolvedAfter)

  return (
    sources.find((snapshot) => {
      if (snapshot.source !== source) {
        return false
      }

      if (snapshot.freshness !== "failed" || !resolvedAfter) {
        return true
      }

      return new Date(snapshot.capturedAt).getTime() > resolvedAfter
    }) ?? null
  )
}

function getIntegrationAccount(integration: UserIntegration | null) {
  return integration?.providerAccountEmail || integration?.providerUserId || null
}

function isMissingSelectedSourceColumn(error: { message?: string; code?: string } | null) {
  return Boolean(
    error &&
      (error.code === "42703" ||
        /selected_source_id|selected_source_name|does not exist/i.test(error.message ?? "")),
  )
}

async function getNotionSelectedSource(adminClient: AdminClient, userId: string) {
  const { data, error } = await adminClient
    .from("integrations")
    .select("selected_source_id, selected_source_name")
    .eq("user_id", userId)
    .eq("provider", "notion")
    .maybeSingle<{ selected_source_id: string | null; selected_source_name: string | null }>()

  if (isMissingSelectedSourceColumn(error)) {
    return {
      selectedSourceId: null,
      selectedSourceName: null,
    }
  }

  if (error) {
    throw new Error(error.message)
  }

  return {
    selectedSourceId: data?.selected_source_id ?? null,
    selectedSourceName: data?.selected_source_name ?? null,
  }
}

function withNotionSelectedSource(
  integrations: UserIntegration[],
  selectedSource: { selectedSourceId: string | null; selectedSourceName: string | null },
) {
  return integrations.map((integration) => {
    if (integration.provider !== "notion") {
      return integration
    }

    return {
      ...integration,
      selectedSourceId: selectedSource.selectedSourceId,
      selectedSourceName: selectedSource.selectedSourceName,
    }
  })
}

function getDistinctActiveSourceCount(input: {
  sources: SourceSnapshotSummary[]
  sourceConnectors: SourceConnector[]
}) {
  const sourceLabels = new Set<string>()

  for (const connector of input.sourceConnectors) {
    if (connector.enabled && (connector.status === "connected" || connector.status === "ready")) {
      sourceLabels.add(connector.id)
    }
  }

  const connectorEnabledBySource = new Map<string, boolean>(
    input.sourceConnectors.map((connector) => [connector.id, connector.enabled]),
  )

  for (const source of input.sources) {
    if (source.freshness !== "failed" && connectorEnabledBySource.get(source.source) !== false) {
      sourceLabels.add(source.source)
    }
  }

  return sourceLabels.size
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
  canvasIntegration: StoredCanvasIntegration | null
  calDavIntegration: StoredCalDavIntegration | null
  connectorSettings: Map<SourceConnectorId, boolean>
}): SourceConnector[] {
  const googleIntegration = getIntegration(input.integrations, "google")
  const notionIntegration = getIntegration(input.integrations, "notion")
  const canvasPublicIntegration = getIntegration(input.integrations, "canvas")
  const calDavPublicIntegration = getIntegration(input.integrations, "caldav")
  const googleRecoveryAt = input.googleIntegration?.token_updated_at ?? null
  const googleCalendarSource = getLatestActiveSource(input.sources, "google_calendar", {
    resolvedAfter: googleRecoveryAt,
  })
  const gmailSource = getLatestActiveSource(input.sources, "gmail", {
    resolvedAfter: googleRecoveryAt,
  })
  const notionSource = getLatestSource(input.sources, "notion")
  const canvasSource = getLatestSource(input.sources, "canvas")
  const calDavSource = getLatestSource(input.sources, "caldav")
  const googleAccount = getIntegrationAccount(googleIntegration)
  const notionAccount = getIntegrationAccount(notionIntegration)
  const canvasAccount =
    input.canvasIntegration?.provider_account_email ||
    input.canvasIntegration?.provider_user_id ||
    getIntegrationAccount(canvasPublicIntegration)
  const calDavAccount =
    input.calDavIntegration?.provider_account_email ||
    input.calDavIntegration?.provider_user_id ||
    getIntegrationAccount(calDavPublicIntegration)
  const missingGoogleEnv = getMissingEnv(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"])
  const missingNotionEnv = getMissingEnv(["NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET"])
  const sourceConnectors: Array<Omit<SourceConnector, "enabled">> = []

  if (notionIntegration?.status === "connected" && input.notionToken?.access_token) {
    sourceConnectors.push({
      id: "notion",
      status: "connected",
      account: notionAccount,
      canRun: true,
      detail: notionIntegration.selectedSourceName
        ? `${notionAccount ? `${notionAccount}. ` : ""}Import uses ${notionIntegration.selectedSourceName}.`
        : `${notionAccount ? `${notionAccount}. ` : ""}Choose the authoritative tasks database before importing.`,
      selectedSourceId: notionIntegration.selectedSourceId,
      selectedSourceName: notionIntegration.selectedSourceName,
    })
  } else if (missingNotionEnv.length > 0) {
    sourceConnectors.push({
      id: "notion",
      status: "missing_config",
      account: notionAccount,
      canRun: false,
      detail: "This deployment has not configured the Notion connector yet. The app owner must add one Notion public OAuth connection before users can connect a workspace.",
      selectedSourceId: notionIntegration?.selectedSourceId ?? null,
      selectedSourceName: notionIntegration?.selectedSourceName ?? null,
    })
  } else if (notionIntegration?.status === "error" || notionSource?.freshness === "failed") {
    sourceConnectors.push({
      id: "notion",
      status: "failed",
      account: notionAccount,
      canRun: false,
      detail: notionSource?.summary || "Notion authorization failed. Reconnect the workspace.",
      selectedSourceId: notionIntegration?.selectedSourceId ?? null,
      selectedSourceName: notionIntegration?.selectedSourceName ?? null,
    })
  } else {
    sourceConnectors.push({
      id: "notion",
      status: "auth_needed",
      account: notionAccount,
      canRun: false,
      detail: "Authorize a Notion workspace before importing scheduling context.",
      selectedSourceId: notionIntegration?.selectedSourceId ?? null,
      selectedSourceName: notionIntegration?.selectedSourceName ?? null,
    })
  }

  if (missingGoogleEnv.length > 0) {
    sourceConnectors.push({
      id: "google_calendar",
      status: "missing_config",
      account: googleAccount,
      canRun: false,
      detail: `Google OAuth is not configured for this app. Add ${missingGoogleEnv.join(" and ")} on the server before users can authorize Calendar.`,
      selectedSourceId: googleIntegration?.selectedCalendarId ?? null,
      selectedSourceName: null,
    })
    sourceConnectors.push({
      id: "gmail",
      status: "missing_config",
      account: googleAccount,
      canRun: false,
      detail: `Google OAuth is not configured for this app. Add ${missingGoogleEnv.join(" and ")} on the server before users can authorize Gmail.`,
      selectedSourceId: null,
      selectedSourceName: null,
    })
  } else if (!googleIntegration || googleIntegration.status === "disconnected") {
    sourceConnectors.push({
      id: "google_calendar",
      status: "auth_needed",
      account: googleAccount,
      canRun: false,
      detail: "Authorize Google Calendar read access before planning from current commitments.",
      selectedSourceId: googleIntegration?.selectedCalendarId ?? null,
      selectedSourceName: null,
    })
    sourceConnectors.push({
      id: "gmail",
      status: "auth_needed",
      account: googleAccount,
      canRun: false,
      detail: "Authorize Google with Gmail read-only access before scanning mail context.",
      selectedSourceId: null,
      selectedSourceName: null,
    })
  } else if (googleIntegration.status === "error") {
    sourceConnectors.push({
      id: "google_calendar",
      status: "failed",
      account: googleAccount,
      canRun: false,
      detail: googleCalendarSource?.summary || "Google Calendar authorization failed. Reconnect Google before refreshing calendar context.",
      selectedSourceId: googleIntegration.selectedCalendarId,
      selectedSourceName: null,
    })
    sourceConnectors.push({
      id: "gmail",
      status: "failed",
      account: googleAccount,
      canRun: false,
      detail: gmailSource?.summary || "Google authorization failed. Reconnect Google before scanning Gmail.",
      selectedSourceId: null,
      selectedSourceName: null,
    })
  } else if (googleIntegration.status === "needs_reauth" || !hasRunnableGoogleToken(input.googleIntegration)) {
    sourceConnectors.push({
      id: "google_calendar",
      status: "auth_needed",
      account: googleAccount,
      canRun: false,
      detail: `${googleAccount ? `${googleAccount}. ` : ""}Reconnect Google; the connected row exists, but the private OAuth token is missing or expired.`,
      selectedSourceId: googleIntegration.selectedCalendarId,
      selectedSourceName: null,
    })
    sourceConnectors.push({
      id: "gmail",
      status: "auth_needed",
      account: googleAccount,
      canRun: false,
      detail: `${googleAccount ? `${googleAccount}. ` : ""}Reconnect Google; the connected row exists, but the private OAuth token is missing or expired.`,
      selectedSourceId: null,
      selectedSourceName: null,
    })
  } else if (!hasOAuthScope(input.googleIntegration?.scope, GOOGLE_CALENDAR_READONLY_SCOPE)) {
    const gmailScopeReady = hasOAuthScope(input.googleIntegration?.scope, GMAIL_READONLY_SCOPE)
    const gmailRefreshFailed = gmailScopeReady && gmailSource?.freshness === "failed"

    sourceConnectors.push({
      id: "google_calendar",
      status: "auth_needed",
      account: googleAccount,
      canRun: false,
      detail: `${googleAccount ? `${googleAccount}. ` : ""}Reconnect Google once so JARVIS can confirm Calendar read access.`,
      selectedSourceId: googleIntegration.selectedCalendarId,
      selectedSourceName: null,
    })
    sourceConnectors.push({
      id: "gmail",
      status: gmailRefreshFailed ? "failed" : gmailScopeReady ? "ready" : "auth_needed",
      account: googleAccount,
      canRun: gmailScopeReady,
      detail: gmailRefreshFailed
        ? gmailSource.summary
        : gmailScopeReady
          ? `${googleAccount ? `${googleAccount}. ` : ""}Ready to scan recent mail for planning context, small actions, logistics, and deadlines.`
          : `${googleAccount ? `${googleAccount}. ` : ""}Reconnect Google once so JARVIS can confirm Gmail read-only scope.`,
      selectedSourceId: null,
      selectedSourceName: null,
    })
  } else if (!hasOAuthScope(input.googleIntegration?.scope, GMAIL_READONLY_SCOPE)) {
    sourceConnectors.push({
      id: "google_calendar",
      status: googleCalendarSource?.freshness === "failed" ? "failed" : "ready",
      account: googleAccount,
      canRun: true,
      detail: googleCalendarSource?.freshness === "failed"
        ? googleCalendarSource.summary
        : `${googleAccount ? `${googleAccount}. ` : ""}Ready to refresh mirrored Google Calendar events for planning.`,
      selectedSourceId: googleIntegration.selectedCalendarId,
      selectedSourceName: null,
    })
    sourceConnectors.push({
      id: "gmail",
      status: "auth_needed",
      account: googleAccount,
      canRun: false,
      detail: `${googleAccount ? `${googleAccount}. ` : ""}Reconnect Google once so JARVIS can confirm Gmail read-only scope.`,
      selectedSourceId: null,
      selectedSourceName: null,
    })
  } else {
    sourceConnectors.push({
      id: "google_calendar",
      status: googleCalendarSource?.freshness === "failed" ? "failed" : "ready",
      account: googleAccount,
      canRun: true,
      detail: googleCalendarSource?.freshness === "failed"
        ? googleCalendarSource.summary
        : `${googleAccount ? `${googleAccount}. ` : ""}Ready to refresh mirrored Google Calendar events for planning.`,
      selectedSourceId: googleIntegration.selectedCalendarId,
      selectedSourceName: null,
    })

    if (gmailSource?.freshness === "failed") {
      sourceConnectors.push({
        id: "gmail",
        status: "failed",
        account: googleAccount,
        canRun: true,
        detail: gmailSource.summary,
        selectedSourceId: null,
        selectedSourceName: null,
      })
    } else {
      sourceConnectors.push({
        id: "gmail",
        status: "ready",
        account: googleAccount,
        canRun: true,
        detail: `${googleAccount ? `${googleAccount}. ` : ""}Ready to scan recent mail for planning context, small actions, logistics, and deadlines.`,
        selectedSourceId: null,
        selectedSourceName: null,
      })
    }
  }

  if (
    input.calDavIntegration?.status === "connected" &&
    input.calDavIntegration.server_url &&
    input.calDavIntegration.provider_account_email &&
    input.calDavIntegration.password
  ) {
    sourceConnectors.push({
      id: "caldav",
      status: calDavSource?.freshness === "failed" ? "failed" : "ready",
      account: calDavAccount,
      canRun: true,
      detail: calDavSource?.freshness === "failed"
        ? calDavSource.summary
        : `${calDavAccount ? `${calDavAccount}. ` : ""}Ready to refresh ${input.calDavIntegration.server_name ?? "CalDAV"}.`,
      selectedSourceId: input.calDavIntegration.server_url,
      selectedSourceName: input.calDavIntegration.server_name,
    })
  } else if (input.calDavIntegration?.status === "needs_reauth" || input.calDavIntegration?.status === "error") {
    sourceConnectors.push({
      id: "caldav",
      status: "auth_needed",
      account: calDavAccount,
      canRun: false,
      detail: `${calDavAccount ? `${calDavAccount}. ` : ""}Reconnect with your Apple ID email and app-specific password, or choose Custom for another CalDAV server.`,
      selectedSourceId: input.calDavIntegration.server_url,
      selectedSourceName: input.calDavIntegration.server_name,
    })
  } else {
    sourceConnectors.push({
      id: "caldav",
      status: "auth_needed",
      account: calDavAccount,
      canRun: false,
      detail: "Connect Apple Calendar with your Apple ID email and app-specific password.",
      selectedSourceId: input.calDavIntegration?.server_url ?? null,
      selectedSourceName: input.calDavIntegration?.server_name ?? null,
    })
  }

  if (input.canvasIntegration?.status === "connected" && input.canvasIntegration.base_url && input.canvasIntegration.access_token) {
    sourceConnectors.push({
      id: "canvas",
      status: canvasSource?.freshness === "failed" ? "failed" : "ready",
      account: canvasAccount,
      canRun: true,
      detail: canvasSource?.freshness === "failed"
        ? canvasSource.summary
        : `${canvasAccount ? `${canvasAccount}. ` : ""}Ready to import Canvas planner items from ${input.canvasIntegration.base_name ?? input.canvasIntegration.base_url}.`,
      selectedSourceId: input.canvasIntegration.base_url,
      selectedSourceName: input.canvasIntegration.base_name,
    })
  } else if (canvasPublicIntegration?.status === "connected") {
    sourceConnectors.push({
      id: "canvas",
      status: canvasSource?.freshness === "failed" ? "failed" : "ready",
      account: canvasAccount,
      canRun: true,
      detail: canvasSource?.freshness === "failed"
        ? canvasSource.summary
        : `${canvasAccount ? `${canvasAccount}. ` : ""}Connected through the Canvas Reader extension.`,
      selectedSourceId: canvasPublicIntegration.selectedSourceId,
      selectedSourceName: canvasPublicIntegration.selectedSourceName,
    })
  } else if (input.canvasIntegration?.status === "needs_reauth" || input.canvasIntegration?.status === "error") {
    sourceConnectors.push({
      id: "canvas",
      status: "auth_needed",
      account: canvasAccount,
      canRun: false,
      detail: `${canvasAccount ? `${canvasAccount}. ` : ""}Reconnect Canvas with a fresh access token from Canvas settings.`,
      selectedSourceId: input.canvasIntegration.base_url,
      selectedSourceName: input.canvasIntegration.base_name,
    })
  } else {
    sourceConnectors.push({
      id: "canvas",
      status: "auth_needed",
      account: canvasAccount,
      canRun: false,
      detail: "Connect Canvas with a base URL and a personal access token from Settings > New Access Token.",
      selectedSourceId: input.canvasIntegration?.base_url ?? null,
      selectedSourceName: input.canvasIntegration?.base_name ?? null,
    })
  }

  return sourceConnectors.map((connector) => {
    const enabled = isConnectorEnabled(input.connectorSettings, connector.id)

    return {
      ...connector,
      enabled,
      canRun: enabled && connector.canRun,
      detail: enabled
        ? connector.detail
        : "This source is turned off. Turn it on to include it in refreshes and planning.",
    }
  })
}

export async function GET() {
  try {
    const { adminClient, user } = await requireAuthenticatedUser()

    // Quietly reconcile any schedule that went stale while the user was away,
    // before fetching data so the dashboard reflects the reconciled state.
    const recap = await reconcileStaleSchedule(adminClient, user.id)
    const reentry =
      recap.gapDays >= 2 &&
      (recap.unconfirmedCount > 0 || recap.autoImportedCount > 0 || recap.passedDeadlines.length > 0)
        ? {
            gapDays: recap.gapDays,
            unconfirmedCount: recap.unconfirmedCount,
            tasksReturnedToTodo: recap.tasksReturnedToTodo,
            autoImportedCount: recap.autoImportedCount,
            passedDeadlines: recap.passedDeadlines,
          }
        : null

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
      storedCanvasIntegration,
      storedCalDavIntegration,
      connectorSettings,
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
        .limit(60),
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
        .limit(40),
      adminClient
        .from("integrations")
        .select(USER_INTEGRATION_SELECT)
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false }),
      getStoredGoogleIntegration(user.id),
      getStoredIntegrationToken(user.id, "notion"),
      getStoredCanvasIntegration(user.id),
      getStoredCalDavIntegration(user.id),
      getConnectorSettingsForUser(user.id, adminClient),
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
      .filter((row) => !isExcludedScheduleEventTitle((row as ScheduleEventRow).title))
      .map((row) => mapScheduleEventRowToScheduleEvent(row as ScheduleEventRow))
      .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime())
    const memories = (memoryResult.data || []).map((row) => mapMemoryItemRowToSummary(row as MemoryItemRow))
    const sources = (sourceResult.data || []).map((row) => mapSourceSnapshotRowToSummary(row as SourceSnapshotRow))
    const sourceFiles = (sourceFileResult.data || []).map((row) => mapSourceFileRowToSummary(row as SourceFileRow))
    const sourceCandidates = (sourceCandidateResult.data || []).map((row) =>
      mapSourceCandidateRowToCandidate(row as SourceCandidateRow),
    )
    const integrations = withNotionSelectedSource(
      (integrationResult.data || []).map((row) =>
        mapUserIntegrationRowToUserIntegration(row as UserIntegrationRow),
      ),
      await getNotionSelectedSource(adminClient, user.id),
    )
    const sourceConnectors = deriveSourceConnectors({
      integrations,
      sources,
      googleIntegration: storedGoogleIntegration,
      notionToken: storedNotionToken,
      canvasIntegration: storedCanvasIntegration,
      calDavIntegration: storedCalDavIntegration,
      connectorSettings,
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
        sources: getDistinctActiveSourceCount({ sources, sourceConnectors }),
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
      reentry,
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
