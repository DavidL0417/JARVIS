import type { SupabaseClient } from "@supabase/supabase-js"

import { buildMemorySummaryMarkdown, deriveAvailabilityWindowsFromScheduleContext } from "@/lib/ai/openai"
import {
  mapMemoryItemRowToSummary,
  mapPreferencesRowToPreferences,
  mapScheduleEventRowToScheduleEvent,
  mapSourceSnapshotRowToSummary,
  mapTaskRowToTask,
  MEMORY_ITEM_SELECT,
  PREFERENCES_SELECT,
  SCHEDULE_EVENT_SELECT,
  SOURCE_SNAPSHOT_SELECT,
  TASK_SELECT,
} from "@/lib/data/mappers"
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
}

export interface AssistantRuntimeContext {
  userId: string
  preferences: UserPreferences
  preferencesRow: UserPreferencesRow | null
  tasks: Task[]
  events: ScheduleEvent[]
  memoryEntries: MemoryEntrySummary[]
  sourceSnapshots: SourceSnapshotSummary[]
  context: AssistantContextData
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

export async function loadAssistantRuntimeContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<AssistantRuntimeContext> {
  const [preferencesResult, tasksResult, eventsResult, memoryResult, sourceResult] = await Promise.all([
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
    supabase
      .from("schedule_events")
      .select(SCHEDULE_EVENT_SELECT)
      .eq("user_id", userId)
      .order("starts_at", { ascending: true }),
    supabase
      .from("memory_items")
      .select(MEMORY_ITEM_SELECT)
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("source_snapshots")
      .select(SOURCE_SNAPSHOT_SELECT)
      .eq("user_id", userId)
      .order("captured_at", { ascending: false })
      .limit(10),
  ])

  const firstError =
    preferencesResult.error ||
    tasksResult.error ||
    eventsResult.error ||
    memoryResult.error ||
    sourceResult.error

  if (firstError) {
    throw new Error(firstError.message)
  }

  const preferences = {
    ...DEFAULT_PREFERENCES,
    userId,
    ...mapPreferencesRowToPreferences(preferencesResult.data),
  }
  const tasks = (tasksResult.data || []).map((row) => mapTaskRowToTask(row as TaskRow))
  const events = (eventsResult.data || []).map((row) =>
    mapScheduleEventRowToScheduleEvent(row as ScheduleEventRow),
  )
  const memoryEntries = (memoryResult.data || []).map((row) =>
    mapMemoryItemRowToSummary(row as MemoryItemRow),
  )
  const sourceSnapshots = (sourceResult.data || []).map((row) =>
    mapSourceSnapshotRowToSummary(row as SourceSnapshotRow),
  )
  const availabilityWindows = deriveAvailabilityWindowsFromScheduleContext({
    userId,
    tasks,
    preferences,
    hardEvents: events,
    memoryEntries,
    sourceSnapshots,
  })

  const memorySummaryMarkdown = buildMemorySummaryMarkdown({
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

  return {
    userId,
    preferences,
    preferencesRow: preferencesResult.data,
    tasks,
    events,
    memoryEntries,
    sourceSnapshots,
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
      memorySummary: buildMemorySummary(memoryEntries) || memorySummaryMarkdown,
    },
  }
}
