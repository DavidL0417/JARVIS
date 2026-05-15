import { generateSchedule } from "@/lib/ai/claude"
import {
  DEFAULT_CLAUDE_PLANNER_MODEL_KEY,
  getClaudePlannerModelOption,
  type ClaudePlannerModelKey,
} from "@/lib/ai/claude-models"
import { loadLayeredSecretaryContext } from "@/lib/assistant/context"
import {
  DAILY_PLAN_SELECT,
  mapDailyPlanRowToDailyPlan,
  mapMemoryItemRowToSummary,
  mapPreferencesRowToPreferences,
  mapScheduleEventInputToScheduleEvent,
  mapScheduleEventRowToScheduleEvent,
  mapSourceCandidateRowToCandidate,
  mapSourceSnapshotRowToSummary,
  mapTaskRowToTask,
  MEMORY_ITEM_SELECT,
  PREFERENCES_SELECT,
  SCHEDULE_EVENT_SELECT,
  SOURCE_CANDIDATE_SELECT,
  SOURCE_SNAPSHOT_SELECT,
  TASK_SELECT,
} from "@/lib/data/mappers"
import { refreshSourcesForUser } from "@/lib/sources/refresh"
import type { requireAuthenticatedUser } from "@/lib/supabase/auth"
import { TASKS_CALENDAR_ID } from "@/lib/task-calendar-constants"
import type {
  DailyPlan,
  DailyPlanListItem,
  DailyPlanNowItem,
  DailyPlanRiskItem,
  DailyPlanRow,
  ScheduleEvent,
  ScheduleEventInput,
  ScheduleEventInsertRow,
  SchedulePlanResult,
  SchedulePreparationContext,
  SourceCandidateRow,
  SourceCoverageItem,
  SourceSnapshotRow,
  Task,
  TaskRow,
  UserPreferencesRow,
} from "@/types"

type AdminClient = Awaited<ReturnType<typeof requireAuthenticatedUser>>["adminClient"]

const HORIZON_DAYS = 7
const DEFAULT_MODEL_NAME = getClaudePlannerModelOption(DEFAULT_CLAUDE_PLANNER_MODEL_KEY).model

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function minutesBetween(start: string, end: string) {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000))
}

function formatShortTimeRange(event: Pick<ScheduleEvent, "start" | "end">) {
  const start = new Date(event.start)
  const end = new Date(event.end)

  return `${start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}-${end.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`
}

function duePhrase(task: Task) {
  if (!task.deadline) {
    return "no deadline captured"
  }

  const deadline = new Date(task.deadline)
  const now = Date.now()
  const hours = Math.round((deadline.getTime() - now) / 3_600_000)

  if (hours < 0) {
    return "overdue"
  }

  if (hours < 24) {
    return `due in ${Math.max(hours, 1)}h`
  }

  return `due ${deadline.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}`
}

function getEventIdentity(event: Pick<ScheduleEvent, "calendarId" | "title" | "start" | "end" | "location">) {
  return [event.calendarId ?? "", event.title, event.start, event.end, event.location ?? ""].join("::")
}

function sortByStart<T extends { start: string }>(items: T[]) {
  return [...items].sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime())
}

function rankTasksByUrgency(tasks: Task[]) {
  return [...tasks].sort((left, right) => {
    const leftDeadline = left.deadline ? new Date(left.deadline).getTime() : Number.POSITIVE_INFINITY
    const rightDeadline = right.deadline ? new Date(right.deadline).getTime() : Number.POSITIVE_INFINITY
    const priorityWeight = { high: 0, medium: 1, low: 2 }

    return leftDeadline - rightDeadline || priorityWeight[left.priority] - priorityWeight[right.priority]
  })
}

function deriveNowItem(input: {
  tasks: Task[]
  events: ScheduleEvent[]
  now: Date
}): DailyPlanNowItem | null {
  const nowMs = input.now.getTime()
  const taskById = new Map(input.tasks.map((task) => [task.id, task]))
  const currentEvent = sortByStart(input.events).find((event) => {
    const startMs = new Date(event.start).getTime()
    const endMs = new Date(event.end).getTime()
    return event.source === "task" && startMs <= nowMs && endMs > nowMs
  })

  if (currentEvent) {
    const task = currentEvent.taskId ? taskById.get(currentEvent.taskId) : null

    return {
      title: currentEvent.title,
      why: task
        ? `${duePhrase(task)}, already placed in this open block.`
        : `Scheduled now from ${formatShortTimeRange(currentEvent)}.`,
      start: currentEvent.start,
      end: currentEvent.end,
      taskId: currentEvent.taskId,
      eventId: currentEvent.id,
    }
  }

  const nextEvent = sortByStart(input.events).find((event) => {
    return event.source === "task" && new Date(event.start).getTime() > nowMs
  })

  if (nextEvent) {
    const task = nextEvent.taskId ? taskById.get(nextEvent.taskId) : null

    return {
      title: nextEvent.title,
      why: task
        ? `${duePhrase(task)}, next planned block is ${formatShortTimeRange(nextEvent)}.`
        : `Next planned block is ${formatShortTimeRange(nextEvent)}.`,
      start: nextEvent.start,
      end: nextEvent.end,
      taskId: nextEvent.taskId,
      eventId: nextEvent.id,
    }
  }

  const fallbackTask = rankTasksByUrgency(
    input.tasks.filter((task) => task.status !== "completed" && task.status !== "missed"),
  )[0]

  if (!fallbackTask) {
    return null
  }

  return {
    title: fallbackTask.title,
    why: `${duePhrase(fallbackTask)}, but no work block is placed yet.`,
    start: null,
    end: null,
    taskId: fallbackTask.id,
    eventId: null,
  }
}

function deriveNextItems(events: ScheduleEvent[], now: Date): DailyPlanListItem[] {
  const nowMs = now.getTime()

  return sortByStart(events)
    .filter((event) => new Date(event.end).getTime() > nowMs)
    .slice(0, 5)
    .map((event) => ({
      title: event.title,
      start: event.start,
      end: event.end,
      kind: event.source === "calendar" ? "event" : event.source === "focus" ? "routine" : "task",
    }))
}

function deriveRiskItems(input: {
  tasks: Task[]
  events: ScheduleEvent[]
  schedule: SchedulePlanResult
  pendingCandidateCount: number
  failedSourceSummaries: string[]
  horizonEnd: Date
}): DailyPlanRiskItem[] {
  const nowMs = Date.now()
  const scheduledTaskIds = new Set(
    input.events
      .map((event) => event.taskId)
      .filter((taskId): taskId is string => Boolean(taskId)),
  )
  const risks: DailyPlanRiskItem[] = []

  for (const task of input.tasks) {
    if (task.status === "completed" || task.status === "missed") {
      continue
    }

    const deadlineMs = task.deadline ? new Date(task.deadline).getTime() : null

    if (deadlineMs && deadlineMs < nowMs) {
      risks.push({
        title: "Overdue work",
        detail: `${task.title} is past its deadline.`,
        severity: "high",
        taskId: task.id,
      })
      continue
    }

    if (
      deadlineMs &&
      deadlineMs <= input.horizonEnd.getTime() &&
      !scheduledTaskIds.has(task.id) &&
      !input.schedule.unscheduledTaskIds.includes(task.id)
    ) {
      risks.push({
        title: "Deadline without block",
        detail: `${task.title} is ${duePhrase(task)} and still needs a block.`,
        severity: task.priority === "high" ? "high" : "medium",
        taskId: task.id,
      })
    }
  }

  for (const taskId of input.schedule.unscheduledTaskIds) {
    const task = input.tasks.find((item) => item.id === taskId)

    if (task) {
      risks.push({
        title: "Planner could not fit task",
        detail: `${task.title} was left unscheduled by the planner.`,
        severity: task.priority === "high" ? "high" : "medium",
        taskId: task.id,
      })
    }
  }

  const eventMinutesByDay = new Map<string, number>()

  for (const event of input.events) {
    const day = new Date(event.start).toISOString().slice(0, 10)
    eventMinutesByDay.set(day, (eventMinutesByDay.get(day) ?? 0) + minutesBetween(event.start, event.end))
  }

  for (const [day, minutes] of eventMinutesByDay) {
    if (minutes >= 9 * 60) {
      risks.push({
        title: "Overloaded day",
        detail: `${day} has ${Math.round(minutes / 60)} hours already placed.`,
        severity: "medium",
      })
    }
  }

  if (input.pendingCandidateCount > 0) {
    risks.push({
      title: "Review queue waiting",
      detail: `${input.pendingCandidateCount} extracted item${input.pendingCandidateCount === 1 ? "" : "s"} need approval before JARVIS can fully trust the plan.`,
      severity: "medium",
    })
  }

  for (const summary of input.failedSourceSummaries.slice(0, 2)) {
    risks.push({
      title: "Source refresh failed",
      detail: summary,
      severity: "high",
    })
  }

  return risks.slice(0, 8)
}

function deriveSourceCoverage(input: {
  sources: ReturnType<typeof mapSourceSnapshotRowToSummary>[]
  integrations: Array<{ provider: string; status: string | null }>
  sourceFileCount: number
}): SourceCoverageItem[] {
  const latestBySource = new Map<string, ReturnType<typeof mapSourceSnapshotRowToSummary>>()

  for (const source of input.sources) {
    if (!latestBySource.has(source.source)) {
      latestBySource.set(source.source, source)
    }
  }

  const googleIntegration = input.integrations.find((integration) => integration.provider === "google")
  const notionIntegration = input.integrations.find((integration) => integration.provider === "notion")
  const notionSnapshot = latestBySource.get("notion")
  const gmailSnapshot = latestBySource.get("gmail")
  const fileSnapshot = latestBySource.get("manual")
  const coverage: SourceCoverageItem[] = [
    {
      label: "Google Calendar",
      status: googleIntegration?.status === "connected" ? "connected" : latestBySource.get("google_calendar")?.freshness ?? "missing",
      detail: googleIntegration?.status === "connected"
        ? "Connected for fixed commitments."
        : latestBySource.get("google_calendar")?.summary ?? "Not connected yet.",
    },
  ]

  if (notionIntegration?.status === "connected" || notionSnapshot) {
    coverage.push({
      label: "Notion",
      status: notionIntegration?.status === "connected" ? "connected" : notionSnapshot?.freshness ?? "missing",
      detail: notionIntegration?.status === "connected"
        ? "Connected for workspace import."
        : notionSnapshot?.summary ?? "No Notion import yet.",
    })
  }

  if (gmailSnapshot) {
    coverage.push({
      label: "Gmail",
      status: gmailSnapshot.freshness,
      detail: gmailSnapshot.summary,
    })
  }

  if (input.sourceFileCount > 0 || fileSnapshot) {
    coverage.push({
      label: "Files",
      status: input.sourceFileCount > 0 ? "connected" : fileSnapshot?.freshness ?? "missing",
      detail: input.sourceFileCount > 0 ? `${input.sourceFileCount} original source file${input.sourceFileCount === 1 ? "" : "s"} stored.` : fileSnapshot?.summary ?? "No source files uploaded.",
    })
  }

  return coverage
}

async function loadScheduleContext(input: {
  adminClient: AdminClient
  userId: string
  hardEvents: ScheduleEventInput[]
}): Promise<{
  context: SchedulePreparationContext
  persistedEvents: ScheduleEvent[]
  pendingCandidateCount: number
  failedSourceSummaries: string[]
  sourceCoverage: SourceCoverageItem[]
}> {
  const [
    tasksResult,
    preferencesResult,
    eventsResult,
    memoryResult,
    sourceResult,
    candidateResult,
    sourceFileResult,
    integrationResult,
  ] = await Promise.all([
    input.adminClient
      .from("tasks")
      .select(TASK_SELECT)
      .eq("user_id", input.userId)
      .order("created_at", { ascending: true }),
    input.adminClient
      .from("preferences")
      .select(PREFERENCES_SELECT)
      .eq("user_id", input.userId)
      .maybeSingle<UserPreferencesRow>(),
    input.adminClient
      .from("schedule_events")
      .select(SCHEDULE_EVENT_SELECT)
      .eq("user_id", input.userId)
      .order("starts_at", { ascending: true }),
    input.adminClient
      .from("memory_items")
      .select(MEMORY_ITEM_SELECT)
      .eq("user_id", input.userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(20),
    input.adminClient
      .from("source_snapshots")
      .select(SOURCE_SNAPSHOT_SELECT)
      .eq("user_id", input.userId)
      .order("captured_at", { ascending: false })
      .limit(16),
    input.adminClient
      .from("source_candidates")
      .select(SOURCE_CANDIDATE_SELECT)
      .eq("user_id", input.userId)
      .order("created_at", { ascending: false })
      .limit(50),
    input.adminClient
      .from("source_files")
      .select("id")
      .eq("user_id", input.userId)
      .limit(50),
    input.adminClient
      .from("integrations")
      .select("provider, status")
      .eq("user_id", input.userId),
  ])

  if (
    tasksResult.error ||
    preferencesResult.error ||
    eventsResult.error ||
    memoryResult.error ||
    sourceResult.error ||
    candidateResult.error ||
    sourceFileResult.error ||
    integrationResult.error
  ) {
    throw new Error(
      tasksResult.error?.message ||
        preferencesResult.error?.message ||
        eventsResult.error?.message ||
        memoryResult.error?.message ||
        sourceResult.error?.message ||
        candidateResult.error?.message ||
        sourceFileResult.error?.message ||
        integrationResult.error?.message ||
        "Failed to load daily planning context.",
    )
  }

  const tasks = (tasksResult.data || []).map((row) => mapTaskRowToTask(row as TaskRow))
  const selectedTaskIds = new Set(tasks.map((task) => task.id))
  const requestHardEvents = input.hardEvents
    .filter((event) => !event.taskId || !selectedTaskIds.has(event.taskId))
    .map((event) => mapScheduleEventInputToScheduleEvent(event, input.userId))
  const requestHardEventKeys = new Set(requestHardEvents.map(getEventIdentity))
  const persistedEvents = (eventsResult.data || [])
    .map((event) => mapScheduleEventRowToScheduleEvent(event as Parameters<typeof mapScheduleEventRowToScheduleEvent>[0]))
  const persistedHardEvents = persistedEvents
    .filter((event) => !event.taskId || !selectedTaskIds.has(event.taskId))
    .filter((event) => !requestHardEventKeys.has(getEventIdentity(event)))
  const sources = (sourceResult.data || []).map((row) => mapSourceSnapshotRowToSummary(row as SourceSnapshotRow))
  const candidates = (candidateResult.data || []).map((row) => mapSourceCandidateRowToCandidate(row as SourceCandidateRow))

  return {
    context: {
      userId: input.userId,
      tasks,
      preferences: mapPreferencesRowToPreferences(preferencesResult.data),
      hardEvents: [...requestHardEvents, ...persistedHardEvents],
      memoryEntries: (memoryResult.data || []).map((row) => mapMemoryItemRowToSummary(row as Parameters<typeof mapMemoryItemRowToSummary>[0])),
      sourceSnapshots: sources,
    },
    persistedEvents,
    pendingCandidateCount: candidates.filter((candidate) => candidate.status === "pending").length,
    failedSourceSummaries: sources
      .filter((source) => source.freshness === "failed")
      .map((source) => source.summary),
    sourceCoverage: deriveSourceCoverage({
      sources,
      integrations: (integrationResult.data || []) as Array<{ provider: string; status: string | null }>,
      sourceFileCount: (sourceFileResult.data || []).length,
    }),
  }
}

async function persistSchedulePlan(input: {
  adminClient: AdminClient
  userId: string
  context: SchedulePreparationContext
  schedule: SchedulePlanResult
  planId: string
}) {
  const selectedTaskIds = input.context.tasks.map((task) => task.id)

  if (selectedTaskIds.length === 0) {
    return
  }

  const now = new Date().toISOString()
  const selectedTaskIdSet = new Set(selectedTaskIds)
  const taskEvents = input.schedule.proposedEvents.filter(
    (event) =>
      event.source === "task" &&
      event.taskId &&
      selectedTaskIdSet.has(event.taskId),
  )

  const { data: existingTaskEvents, error: existingTaskEventsError } = await input.adminClient
    .from("schedule_events")
    .select("id, task_id, is_immutable")
    .eq("user_id", input.userId)
    .eq("source", "task")
    .in("task_id", selectedTaskIds)

  if (existingTaskEventsError) {
    throw new Error(existingTaskEventsError.message)
  }

  const mutableEventIds = (existingTaskEvents ?? [])
    .filter((event) => event.is_immutable === false)
    .map((event) => event.id)

  if (mutableEventIds.length > 0) {
    const { error } = await input.adminClient
      .from("schedule_events")
      .delete()
      .in("id", mutableEventIds)

    if (error) {
      throw new Error(error.message)
    }
  }

  const rowsToInsert: ScheduleEventInsertRow[] = taskEvents.map((event) => ({
    user_id: input.userId,
    task_id: event.taskId,
    title: event.title,
    starts_at: event.start,
    ends_at: event.end,
    source: "task",
    priority: event.priority,
    status: "scheduled",
    location: event.location,
    external_event_id: event.externalEventId,
    gcal_event_id: event.gcalEventId,
    last_synced_from: event.lastSyncedFrom,
    is_immutable: event.isImmutable,
    is_checked_in: event.isCheckedIn,
    all_day: false,
    calendar_id: event.calendarId ?? TASKS_CALENDAR_ID,
    plan_id: input.planId,
  }))

  if (rowsToInsert.length > 0) {
    const { error } = await input.adminClient.from("schedule_events").insert(rowsToInsert)

    if (error) {
      throw new Error(error.message)
    }
  }

  const selectedTaskMap = new Map(input.context.tasks.map((task) => [task.id, task]))
  const eventByTaskId = new Map(
    taskEvents
      .filter((event): event is typeof event & { taskId: string } => Boolean(event.taskId))
      .map((event) => [event.taskId, event]),
  )

  await Promise.all(
    selectedTaskIds.map(async (taskId) => {
      const task = selectedTaskMap.get(taskId)

      if (!task) {
        return
      }

      const taskEvent = eventByTaskId.get(taskId)

      if (!taskEvent) {
        if (task.isImmutable && task.scheduledFor) {
          return
        }

        const { error } = await input.adminClient
          .from("tasks")
          .update({
            scheduled_for: null,
            status: task.status === "completed" ? "completed" : "todo",
            plan_id: null,
            updated_at: now,
          })
          .eq("id", taskId)
          .eq("user_id", input.userId)

        if (error) {
          throw new Error(error.message)
        }

        return
      }

      const { error } = await input.adminClient
        .from("tasks")
        .update({
          scheduled_for: taskEvent.start,
          status: "scheduled",
          plan_id: input.planId,
          updated_at: now,
        })
        .eq("id", taskId)
        .eq("user_id", input.userId)

      if (error) {
        throw new Error(error.message)
      }
    }),
  )
}

export async function buildDailyPlan(input: {
  adminClient: AdminClient
  userId: string
  hardEvents: ScheduleEventInput[]
  command?: string | null
  plannerModel?: ClaudePlannerModelKey | null
}): Promise<{ dailyPlan: DailyPlan; schedule: SchedulePlanResult; taskCount: number }> {
  const now = new Date()
  const horizonEnd = addDays(now, HORIZON_DAYS)
  const sourceRefresh = await refreshSourcesForUser({
    adminClient: input.adminClient,
    userId: input.userId,
    mode: "pre_plan",
    force: true,
  })
  const layeredContext = await loadLayeredSecretaryContext(input.adminClient, input.userId)
  const loaded = await loadScheduleContext({
    adminClient: input.adminClient,
    userId: input.userId,
    hardEvents: input.hardEvents,
  })
  const command = input.command?.trim() || null
  loaded.context.memoryEntries = layeredContext.memoryEntries
  loaded.context.sourceSnapshots = layeredContext.sourceSnapshots
  loaded.context.command = command
  loaded.context.layeredContextMarkdown = layeredContext.layeredContextMarkdown
  loaded.context.sourceStatus = loaded.sourceCoverage
  loaded.context.plannerTradeoffContext = [
    command ? `User planning command: ${command}` : null,
    ...sourceRefresh.items.map((item) => `${item.source}: ${item.status} - ${item.summary}`),
    ...layeredContext.recentChangeLogSummaries.slice(0, 5).map((summary) => `Recent schedule feedback: ${summary}`),
  ].filter((item): item is string => Boolean(item))
  const plannerModel = input.plannerModel ?? DEFAULT_CLAUDE_PLANNER_MODEL_KEY
  const schedule = await generateSchedule(loaded.context, {
    modelKey: plannerModel,
  })
  const plannerModelName = getClaudePlannerModelOption(plannerModel).model
  const proposedEvents = schedule.proposedEvents
  const nowItem = deriveNowItem({
    tasks: loaded.context.tasks,
    events: proposedEvents,
    now,
  })
  const nextItems = deriveNextItems(proposedEvents, now)
  const riskItems = deriveRiskItems({
    tasks: loaded.context.tasks,
    events: proposedEvents,
    schedule,
    pendingCandidateCount: loaded.pendingCandidateCount,
    failedSourceSummaries: loaded.failedSourceSummaries,
    horizonEnd,
  })
  const tradeoffs = [
    ...schedule.tradeoffNotes,
    schedule.unscheduledTaskIds.length > 0
      ? `${schedule.unscheduledTaskIds.length} task${schedule.unscheduledTaskIds.length === 1 ? "" : "s"} could not be placed without breaking constraints.`
      : null,
    command ? `Replanned around command: ${command}` : null,
  ].filter((item): item is string => Boolean(item))

  await input.adminClient
    .from("daily_plans")
    .update({
      status: "superseded",
      updated_at: now.toISOString(),
    })
    .eq("user_id", input.userId)
    .neq("status", "superseded")

  const { data: planRow, error: planError } = await input.adminClient
    .from("daily_plans")
    .insert({
      user_id: input.userId,
      horizon_start: now.toISOString(),
      horizon_end: horizonEnd.toISOString(),
      status: "ready",
      summary: schedule.summary,
      now_item: nowItem,
      next_items: nextItems,
      risk_items: riskItems,
      tradeoffs,
      source_coverage: loaded.sourceCoverage,
      command,
      model: plannerModelName || DEFAULT_MODEL_NAME,
    })
    .select(DAILY_PLAN_SELECT)
    .single<DailyPlanRow>()

  if (planError || !planRow) {
    throw new Error(planError?.message ?? "Failed to persist daily plan.")
  }

  await persistSchedulePlan({
    adminClient: input.adminClient,
    userId: input.userId,
    context: loaded.context,
    schedule,
    planId: planRow.id,
  })

  return {
    dailyPlan: mapDailyPlanRowToDailyPlan(planRow),
    schedule,
    taskCount: loaded.context.tasks.length,
  }
}
