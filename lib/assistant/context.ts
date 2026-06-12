import type { SupabaseClient } from "@supabase/supabase-js"

import { ensureDefaultSecretaryMemoryForUser } from "@/lib/assistant/default-memory"
import { buildMemorySummaryMarkdown, deriveAvailabilityWindowsFromScheduleContext } from "@/lib/ai/claude"
import { isExcludedScheduleEventTitle } from "@/lib/task-calendar-constants"
import {
  DAILY_PLAN_SELECT,
  mapMemoryItemRowToSummary,
  mapDailyPlanRowToDailyPlan,
  mapPreferencesRowToPreferences,
  mapScheduleEventRowToScheduleEvent,
  mapSourceSnapshotRowToSummary,
  mapTaskRowToTask,
  MEMORY_ITEM_SELECT,
  PREFERENCES_SELECT,
  SOURCE_SNAPSHOT_SELECT,
  TASK_SELECT,
} from "@/lib/data/mappers"
import { listScheduleEventRowsInWindow } from "@/lib/supabase/schedule-events"
import type {
  AssistantContextData,
  MemoryEntrySummary,
  MemoryItemRow,
  ScheduleEvent,
  ScheduleEventRow,
  SourceSnapshotRow,
  SourceSnapshotSummary,
  Task,
  TaskRow,
  UserPreferences,
  UserPreferencesRow,
  DailyPlanRow,
  DailyPlan,
  MemoryLayer,
  MemoryImportance,
} from "@/types"

const DEFAULT_TIMEZONE = "America/Chicago"

const DEFAULT_PREFERENCES: UserPreferences = {
  userId: "",
  timezone: DEFAULT_TIMEZONE,
  sleepPattern: null,
  peakEnergyWindow: null,
  procrastinationPattern: null,
  workdayStart: "09:00",
  workdayEnd: "17:00",
  defaultTaskDurationMinutes: 50,
  breakDurationMinutes: 10,
  preferredFocusBlockMinutes: null,
  preferredCheckInMode: "quiet",
  calendarId: null,
  plannerHorizonDays: 28,
}

export interface AssistantRuntimeContext {
  userId: string
  preferences: UserPreferences
  preferencesRow: UserPreferencesRow | null
  tasks: Task[]
  events: ScheduleEvent[]
  memoryEntries: MemoryEntrySummary[]
  sourceSnapshots: SourceSnapshotSummary[]
  latestDailyPlan: DailyPlan | null
  pendingCandidateCount: number
  recentChangeLogSummaries: string[]
  layeredContextMarkdown: string
  context: AssistantContextData
}

export const MEMORY_LAYER_ORDER: MemoryLayer[] = [
  "operating_rules",
  "planning_profile",
  "durable_preferences",
  "task_context",
  "deadline_context",
  "calendar_context",
  "source_status",
  "feedback_observations",
  "candidate_memories",
]

// How many memories of each layer the planner sees. Operating rules and durable
// preferences earn the most slots (they govern judgment); status/candidate
// layers earn the fewest (they churn and are lower-signal).
const PLANNER_MEMORY_LAYER_CAPS: Record<MemoryLayer, number> = {
  operating_rules: 15,
  planning_profile: 10,
  durable_preferences: 15,
  task_context: 8,
  deadline_context: 10,
  calendar_context: 6,
  source_status: 4,
  feedback_observations: 8,
  candidate_memories: 5,
}
const PLANNER_MEMORY_TOTAL_CAP = 60
const PLANNER_MEMORY_IMPORTANCE_RANK: Record<MemoryImportance, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

/**
 * Pick the memories the planner should see, importance-weighted rather than
 * merely recent. Sort by layer priority → importance → recency, then apply
 * per-layer caps and an overall cap so high-signal rules are never crowded out
 * by a burst of low-signal candidate notes.
 */
export function selectPlannerMemories(entries: MemoryEntrySummary[]): MemoryEntrySummary[] {
  const layerRank = new Map(MEMORY_LAYER_ORDER.map((layer, index) => [layer, index]))
  const fallbackLayerRank = MEMORY_LAYER_ORDER.length

  const sorted = [...entries].sort((a, b) => {
    const layerA = layerRank.get(a.layer) ?? fallbackLayerRank
    const layerB = layerRank.get(b.layer) ?? fallbackLayerRank
    if (layerA !== layerB) return layerA - layerB

    const importanceA = PLANNER_MEMORY_IMPORTANCE_RANK[a.importance] ?? 3
    const importanceB = PLANNER_MEMORY_IMPORTANCE_RANK[b.importance] ?? 3
    if (importanceA !== importanceB) return importanceA - importanceB

    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  const perLayerCount = new Map<MemoryLayer, number>()
  const selected: MemoryEntrySummary[] = []

  for (const entry of sorted) {
    if (selected.length >= PLANNER_MEMORY_TOTAL_CAP) break

    const cap = PLANNER_MEMORY_LAYER_CAPS[entry.layer] ?? 5
    const count = perLayerCount.get(entry.layer) ?? 0
    if (count >= cap) continue

    perLayerCount.set(entry.layer, count + 1)
    selected.push(entry)
  }

  return selected
}

function buildAvailabilitySummary(
  preferences: UserPreferences,
  memoryEntries: MemoryEntrySummary[],
  sourceSnapshots: SourceSnapshotSummary[],
) {
  const lines = [
    `Timezone: ${preferences.timezone}`,
    `Workday: ${preferences.workdayStart} to ${preferences.workdayEnd}`,
    `Default block: ${preferences.defaultTaskDurationMinutes} minutes`,
    `Break: ${preferences.breakDurationMinutes} minutes`,
  ]

  if (preferences.peakEnergyWindow) {
    lines.push(`Peak energy: ${preferences.peakEnergyWindow}`)
  }

  if (preferences.sleepPattern) {
    lines.push(`Sleep/no-work: ${preferences.sleepPattern}`)
  }

  if (preferences.procrastinationPattern) {
    lines.push(`Planning friction: ${preferences.procrastinationPattern}`)
  }

  const criticalNotes = memoryEntries
    .filter((entry) => entry.importance === "critical" || entry.importance === "high")
    .slice(0, 3)
    .map((entry) => entry.insight)

  if (criticalNotes.length > 0) {
    lines.push(`Memory: ${criticalNotes.join(" | ")}`)
  }

  const failedSources = sourceSnapshots
    .filter((snapshot) => snapshot.freshness === "failed" || snapshot.freshness === "stale")
    .slice(0, 2)

  if (failedSources.length > 0) {
    lines.push(`Source warnings: ${failedSources.map((snapshot) => snapshot.summary).join(" | ")}`)
  }

  return lines.join("\n")
}

function buildMemorySummary(memoryEntries: MemoryEntrySummary[]) {
  if (memoryEntries.length === 0) {
    return "No saved memory notes yet."
  }

  return memoryEntries
    .slice(0, 8)
    .map((entry) => `${entry.insight}${entry.category ? ` (${entry.category})` : ""}`)
    .join("\n")
}

function titleCaseLayer(layer: MemoryLayer) {
  return layer
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function buildLayeredMemoryMarkdown(input: {
  preferences: UserPreferences
  memoryEntries: MemoryEntrySummary[]
  sourceSnapshots: SourceSnapshotSummary[]
  latestDailyPlan: DailyPlan | null
  pendingCandidateCount: number
  recentChangeLogSummaries: string[]
}) {
  const lines: string[] = [
    "# Layered Secretary Context",
    "",
    "## Structured Preferences",
    `- Timezone: ${input.preferences.timezone}`,
    `- Workday: ${input.preferences.workdayStart} to ${input.preferences.workdayEnd}`,
    `- Default block: ${input.preferences.defaultTaskDurationMinutes} minutes`,
    `- Break: ${input.preferences.breakDurationMinutes} minutes`,
  ]

  if (input.preferences.sleepPattern) {
    lines.push(`- Sleep: ${input.preferences.sleepPattern}`)
  }

  if (input.preferences.peakEnergyWindow) {
    lines.push(`- Peak energy: ${input.preferences.peakEnergyWindow}`)
  }

  if (input.preferences.procrastinationPattern) {
    lines.push(`- Planning friction: ${input.preferences.procrastinationPattern}`)
  }

  for (const layer of MEMORY_LAYER_ORDER) {
    const entries = input.memoryEntries.filter((entry) => entry.layer === layer)

    if (entries.length === 0) {
      continue
    }

    lines.push("", `## ${titleCaseLayer(layer)}`)

    for (const entry of entries) {
      const meta = [
        entry.importance,
        entry.importanceNote,
        entry.source,
      ].filter(Boolean).join("; ")
      lines.push(meta ? `- ${entry.insight} (${meta})` : `- ${entry.insight}`)
    }
  }

  if (input.sourceSnapshots.length > 0) {
    lines.push("", "## Source Status")

    for (const snapshot of input.sourceSnapshots.slice(0, 8)) {
      lines.push(`- ${snapshot.source}: ${snapshot.freshness}. ${snapshot.summary}`)
    }
  }

  if (input.pendingCandidateCount > 0) {
    lines.push("", "## Review Queue", `- ${input.pendingCandidateCount} source candidate${input.pendingCandidateCount === 1 ? "" : "s"} await approval.`)
  }

  if (input.latestDailyPlan) {
    lines.push("", "## Latest Daily Plan", `- ${input.latestDailyPlan.summary}`)
  }

  if (input.recentChangeLogSummaries.length > 0) {
    lines.push("", "## Recent Assistant Changes")

    for (const summary of input.recentChangeLogSummaries.slice(0, 6)) {
      lines.push(`- ${summary}`)
    }
  }

  return lines.join("\n").trim()
}

export async function loadAssistantRuntimeContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<AssistantRuntimeContext> {
  await ensureDefaultSecretaryMemoryForUser(supabase, userId)

  const [
    preferencesResult,
    tasksResult,
    eventsResult,
    memoryResult,
    sourceResult,
    dailyPlanResult,
    candidateCountResult,
    changeLogResult,
  ] = await Promise.all([
    supabase
      .from("preferences")
      .select(PREFERENCES_SELECT)
      .eq("user_id", userId)
      .maybeSingle<UserPreferencesRow>(),
    supabase
      .from("tasks")
      .select(TASK_SELECT)
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    // Windowed + paginated: the unbounded read hit Supabase's 1000-row cap, hiding
    // all upcoming events from the assistant once total mirrored events passed 1000.
    listScheduleEventRowsInWindow(supabase, userId, { lookbackDays: 30, lookaheadDays: 180 }),
    supabase
      .from("memory_items")
      .select(MEMORY_ITEM_SELECT)
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("source_snapshots")
      .select(SOURCE_SNAPSHOT_SELECT)
      .eq("user_id", userId)
      .order("captured_at", { ascending: false })
      .limit(16),
    supabase
      .from("daily_plans")
      .select(DAILY_PLAN_SELECT)
      .eq("user_id", userId)
      .neq("status", "superseded")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<DailyPlanRow>(),
    supabase
      .from("source_candidates")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "pending"),
    supabase
      .from("change_logs")
      .select("summary, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(8),
  ])

  const firstError =
    preferencesResult.error ||
    tasksResult.error ||
    eventsResult.error ||
    memoryResult.error ||
    sourceResult.error ||
    dailyPlanResult.error ||
    candidateCountResult.error ||
    changeLogResult.error

  if (firstError) {
    throw new Error(firstError.message)
  }

  const preferences = {
    ...DEFAULT_PREFERENCES,
    userId,
    ...mapPreferencesRowToPreferences(preferencesResult.data),
  }
  const tasks = (tasksResult.data || []).map((row) => mapTaskRowToTask(row as TaskRow))
  const events = (eventsResult.data || [])
    .filter((row) => !isExcludedScheduleEventTitle((row as ScheduleEventRow).title))
    .map((row) => mapScheduleEventRowToScheduleEvent(row as ScheduleEventRow))
  const memoryEntries = selectPlannerMemories(
    (memoryResult.data || []).map((row) => mapMemoryItemRowToSummary(row as MemoryItemRow)),
  )
  const sourceSnapshots = (sourceResult.data || []).map((row) =>
    mapSourceSnapshotRowToSummary(row as SourceSnapshotRow),
  )
  const latestDailyPlan = dailyPlanResult.data ? mapDailyPlanRowToDailyPlan(dailyPlanResult.data) : null
  const pendingCandidateCount = candidateCountResult.count ?? 0
  const recentChangeLogSummaries = (changeLogResult.data || [])
    .map((row) => row.summary)
    .filter((summary): summary is string => Boolean(summary))
  const availabilityWindows = deriveAvailabilityWindowsFromScheduleContext({
    userId,
    tasks,
    preferences,
    hardEvents: events,
    memoryEntries,
    sourceSnapshots,
  })

  const legacyMemorySummaryMarkdown = buildMemorySummaryMarkdown({
    preferences: {
      timezone: preferences.timezone,
      workdayStart: preferences.workdayStart,
      workdayEnd: preferences.workdayEnd,
      defaultTaskDurationMinutes: preferences.defaultTaskDurationMinutes,
      breakDurationMinutes: preferences.breakDurationMinutes,
      preferredFocusBlockMinutes: preferences.preferredFocusBlockMinutes,
      peakEnergyWindow: preferences.peakEnergyWindow,
      procrastinationPattern: preferences.procrastinationPattern,
      sleepPattern: preferences.sleepPattern,
      preferredCheckInMode: preferences.preferredCheckInMode,
      calendarId: preferences.calendarId,
    },
    memoryEntries: memoryEntries.map((entry) => ({
      category: entry.category,
      insight: entry.insight,
      confidence: entry.confidence,
      source: entry.source,
    })),
  })
  const layeredContextMarkdown = buildLayeredMemoryMarkdown({
    preferences,
    memoryEntries,
    sourceSnapshots,
    latestDailyPlan,
    pendingCandidateCount,
    recentChangeLogSummaries,
  })

  return {
    userId,
    preferences,
    preferencesRow: preferencesResult.data,
    tasks,
    events,
    memoryEntries,
    sourceSnapshots,
    latestDailyPlan,
    pendingCandidateCount,
    recentChangeLogSummaries,
    layeredContextMarkdown,
    context: {
      availability: {
        timezone: preferences.timezone,
        workdayStart: preferences.workdayStart,
        workdayEnd: preferences.workdayEnd,
        peakEnergyWindow: preferences.peakEnergyWindow,
        sleepPattern: preferences.sleepPattern,
        procrastinationPattern: preferences.procrastinationPattern,
        preferredCheckInMode: preferences.preferredCheckInMode,
        defaultTaskDurationMinutes: preferences.defaultTaskDurationMinutes,
        breakDurationMinutes: preferences.breakDurationMinutes,
        preferredFocusBlockMinutes: preferences.preferredFocusBlockMinutes,
        availabilitySummary: buildAvailabilitySummary(preferences, memoryEntries, sourceSnapshots),
      },
      availabilityWindows,
      memoryEntries,
      sourceSnapshots,
      memorySummary: buildMemorySummary(memoryEntries) || legacyMemorySummaryMarkdown,
      layeredContextMarkdown,
      latestDailyPlan,
      pendingCandidateCount,
      recentChangeLogSummaries,
    },
  }
}

export const loadLayeredSecretaryContext = loadAssistantRuntimeContext
