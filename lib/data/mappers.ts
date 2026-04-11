// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import type {
  CheckInStatus,
  ScheduleEvent,
  Task,
  TaskStatus,
  UserPreferences,
} from "@/types"

interface TaskRow {
  id: string
  title: string
  description: string | null
  deadline: string | null
  duration_minutes: number | null
  priority: string | null
  status: string | null
  scheduled_for: string | null
}

interface ScheduleEventRow {
  id: string
  title: string
  starts_at: string
  ends_at: string
  source: string | null
  status: string | null
  location: string | null
}

interface PreferenceRow {
  timezone: string | null
  sleep_pattern: string | null
  peak_energy_window: string | null
  procrastination_pattern: string | null
  workday_start: string | null
  workday_end: string | null
  default_task_duration_minutes: number | null
  break_duration_minutes: number | null
  preferred_focus_block_minutes: number | null
  preferred_checkin_mode: CheckInStatus | null
  calendar_id: string | null
}

function normalizeTaskStatus(value: string | null): TaskStatus {
  if (value === "scheduled" || value === "completed" || value === "missed") {
    return value
  }

  return "todo"
}

function normalizePriority(value: string | null): Task["priority"] {
  if (value === "low" || value === "high") {
    return value
  }

  return "medium"
}

function normalizeEventSource(value: string | null): ScheduleEvent["source"] {
  if (value === "calendar" || value === "focus") {
    return value
  }

  return "task"
}

function normalizeTimeValue(value: string | null, fallback: string) {
  return value?.slice(0, 5) || fallback
}

export function mapTaskRowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description || undefined,
    priority: normalizePriority(row.priority),
    status: normalizeTaskStatus(row.status),
    dueAt: row.deadline,
    scheduledFor: row.scheduled_for,
    estimateMinutes: row.duration_minutes,
    tags: [],
  }
}

export function mapScheduleEventRowToScheduleEvent(row: ScheduleEventRow): ScheduleEvent {
  return {
    id: row.id,
    title: row.title,
    start: row.starts_at,
    end: row.ends_at,
    source: normalizeEventSource(row.source),
    status: row.status ? normalizeTaskStatus(row.status) : undefined,
    location: row.location,
  }
}

export function mapPreferenceRowToUserPreferences(row: PreferenceRow | null): UserPreferences | null {
  if (!row) {
    return null
  }

  return {
    timezone: row.timezone || "America/Chicago",
    sleepPattern: row.sleep_pattern || undefined,
    peakEnergyWindow: row.peak_energy_window || undefined,
    procrastinationPattern: row.procrastination_pattern || undefined,
    workdayStart: normalizeTimeValue(row.workday_start, "09:00"),
    workdayEnd: normalizeTimeValue(row.workday_end, "17:00"),
    defaultTaskDurationMinutes: row.default_task_duration_minutes || 50,
    breakDurationMinutes: row.break_duration_minutes ?? 10,
    preferredFocusBlockMinutes: row.preferred_focus_block_minutes || undefined,
    preferredCheckInMode: row.preferred_checkin_mode || undefined,
    calendarId: row.calendar_id || undefined,
  }
}

export function getCheckInStatus(checkInCount: number): CheckInStatus {
  if (checkInCount <= 0) {
    return "silent"
  }

  if (checkInCount === 1) {
    return "quiet"
  }

  if (checkInCount <= 3) {
    return "gentle"
  }

  return "active"
}

// ##### END BACKEND #####
