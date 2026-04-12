// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import type { SupabaseClient } from "@supabase/supabase-js"

import { mapPreferencesRowToPreferences, mapScheduleEventRowToScheduleEvent, mapTaskRowToTask } from "@/lib/data/mappers"
import { buildMemorySummaryMarkdown, deriveAvailabilityWindowsFromScheduleContext } from "@/lib/ai/claude"
import { createPlaceholderCalendarEvents } from "@/lib/mock-calendar-events"
import type {
  AssistantContextData,
  MemoryEntrySummary,
  ScheduleEvent,
  Task,
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
  context: AssistantContextData
}

function getEventIdentity(event: ScheduleEvent) {
  return [event.calendarId ?? "", event.title, event.start, event.end, event.location ?? ""].join("::")
}

export function buildFallbackAssistantContextData(userId = "00000000-0000-4000-8000-000000000000"): AssistantContextData {
  const preferences = {
    ...DEFAULT_PREFERENCES,
    userId,
  }

  return {
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
      availabilitySummary: "Availability context is unavailable right now.",
    },
    availabilityWindows: [],
    memoryEntries: [],
    memorySummary: "No saved memory notes yet.",
  }
}

function toMemoryEntrySummary(entry: {
  id: string
  category: string
  insight: string
  source: string
  confidence: number | null
  created_at: string
}): MemoryEntrySummary {
  return {
    id: entry.id,
    category: entry.category,
    insight: entry.insight,
    source: entry.source,
    confidence: entry.confidence,
    createdAt: entry.created_at,
  }
}

function buildAvailabilitySummary(preferences: UserPreferences, memoryEntries: MemoryEntrySummary[]) {
  const lines = [
    `Timezone: ${preferences.timezone}`,
    `Preferred work hours: ${preferences.workdayStart} to ${preferences.workdayEnd}`,
    `Default task length: ${preferences.defaultTaskDurationMinutes} minutes`,
    `Preferred break: ${preferences.breakDurationMinutes} minutes`,
  ]

  if (preferences.peakEnergyWindow) {
    lines.push(`Peak-energy window: ${preferences.peakEnergyWindow}`)
  }

  if (preferences.sleepPattern) {
    lines.push(`Sleep / no-work note: ${preferences.sleepPattern}`)
  }

  if (preferences.procrastinationPattern) {
    lines.push(`Planning friction: ${preferences.procrastinationPattern}`)
  }

  const recentNotes = memoryEntries.slice(0, 3).map((entry) => entry.insight)

  if (recentNotes.length > 0) {
    lines.push(`Recent scheduling notes: ${recentNotes.join(" | ")}`)
  }

  return lines.join("\n")
}

function buildMemorySummary(memoryEntries: MemoryEntrySummary[]) {
  if (memoryEntries.length === 0) {
    return "No saved memory notes yet."
  }

  return memoryEntries
    .slice(0, 6)
    .map((entry) => `${entry.insight}${entry.category ? ` (${entry.category})` : ""}`)
    .join("\n")
}

export async function loadAssistantRuntimeContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<AssistantRuntimeContext> {
  const [preferencesResult, tasksResult, eventsResult, memoryResult] = await Promise.all([
    supabase
      .from("preferences")
      .select(
        "id, user_id, timezone, sleep_pattern, peak_energy_window, procrastination_pattern, workday_start, workday_end, default_task_duration_minutes, break_duration_minutes, preferred_focus_block_minutes, preferred_checkin_mode, calendar_id, created_at, updated_at",
      )
      .eq("user_id", userId)
      .maybeSingle<UserPreferencesRow>(),
    supabase
      .from("tasks")
      .select(
        "id, user_id, title, description, deadline, duration_minutes, priority, status, scheduled_for, created_at, updated_at, is_immutable, all_day, calendar_id, tags",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
    supabase
      .from("schedule_events")
      .select(
        "id, user_id, task_id, title, starts_at, ends_at, source, status, location, external_event_id, created_at, updated_at, is_immutable, all_day, calendar_id",
      )
      .eq("user_id", userId)
      .order("starts_at", { ascending: true }),
    supabase
      .from("memory_logs")
      .select("id, category, insight, source, confidence, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(12),
  ])

  const firstError =
    preferencesResult.error || tasksResult.error || eventsResult.error || memoryResult.error

  if (firstError) {
    throw new Error(firstError.message)
  }

  const preferences = {
    ...DEFAULT_PREFERENCES,
    userId,
    ...mapPreferencesRowToPreferences(preferencesResult.data),
  }
  const tasks = (tasksResult.data || []).map(mapTaskRowToTask)
  const persistedEvents = (eventsResult.data || []).map(mapScheduleEventRowToScheduleEvent)
  const placeholderEvents = createPlaceholderCalendarEvents(userId)
  const persistedEventKeys = new Set(persistedEvents.map(getEventIdentity))
  const events = [
    ...placeholderEvents.filter((event) => !persistedEventKeys.has(getEventIdentity(event))),
    ...persistedEvents,
  ].sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime())
  const memoryEntries = (memoryResult.data || []).map(toMemoryEntrySummary)
  const availabilityWindows = deriveAvailabilityWindowsFromScheduleContext({
    userId,
    tasks,
    preferences,
    hardEvents: events,
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
        availabilitySummary: buildAvailabilitySummary(preferences, memoryEntries),
      },
      availabilityWindows,
      memoryEntries,
      memorySummary: buildMemorySummary(memoryEntries) || memorySummaryMarkdown,
    },
  }
}

// ##### END BACKEND #####
