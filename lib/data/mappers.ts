// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import type {
  CheckInInsertRow,
  CheckInRequest,
  OnboardingTaskInput,
  PreferredCheckInMode,
  Priority,
  ScheduleEvent,
  ScheduleEventInput,
  ScheduleEventRow,
  ScheduleEventSource,
  Task,
  TaskInsertRow,
  TaskRow,
  TaskStatus,
  TaskUpdateRow,
  UserPreferences,
  UserPreferencesRow,
  UserPreferencesUpsertRow,
} from "@/types"
import { TASKS_CALENDAR_ID } from "@/lib/tasks-calendar"

function normalizeNullableText(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeDateTime(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return parsed.toISOString()
}

function normalizeTags(tags: string[] | null | undefined): string[] {
  return Array.from(
    new Set(
      (tags || [])
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
    ),
  )
}

function normalizeTaskStatus(value: TaskStatus | string | null | undefined): TaskStatus {
  if (value === "scheduled" || value === "completed" || value === "missed") {
    return value
  }

  return "todo"
}

function normalizePriority(value: Priority | string | null | undefined): Priority {
  if (value === "low" || value === "high") {
    return value
  }

  return "medium"
}

function normalizeEventSource(value: ScheduleEventSource | string | null | undefined): ScheduleEventSource {
  if (value === "calendar" || value === "focus") {
    return value
  }

  return "task"
}

function normalizeTimeValue(value: string | null | undefined, fallback: string) {
  return value?.slice(0, 5) || fallback
}

// Mapper utilities centralize all DB row <-> app model translation.
export function mapTaskRowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: normalizeNullableText(row.description),
    deadline: normalizeDateTime(row.deadline),
    durationMinutes: row.duration_minutes,
    priority: normalizePriority(row.priority),
    status: normalizeTaskStatus(row.status),
    scheduledFor: normalizeDateTime(row.scheduled_for),
    isImmutable: row.is_immutable,
    allDay: row.all_day,
    calendarId: normalizeNullableText(row.calendar_id),
    tags: normalizeTags(row.tags),
  }
}

export function mapTaskToInsert(task: Task): TaskInsertRow {
  return {
    user_id: task.userId,
    title: task.title,
    description: normalizeNullableText(task.description),
    deadline: task.deadline,
    duration_minutes: task.durationMinutes,
    priority: normalizePriority(task.priority),
    status: normalizeTaskStatus(task.status),
    scheduled_for: task.scheduledFor,
    is_immutable: task.isImmutable,
    all_day: task.allDay,
    calendar_id: normalizeNullableText(task.calendarId),
    tags: normalizeTags(task.tags),
  }
}

export function mapTaskToUpdate(task: Partial<Omit<Task, "id" | "userId">>): TaskUpdateRow {
  const update: TaskUpdateRow = {}

  if ("title" in task && typeof task.title === "string") {
    update.title = task.title
  }

  if ("description" in task) {
    update.description = normalizeNullableText(task.description)
  }

  if ("deadline" in task) {
    update.deadline = task.deadline ?? null
  }

  if ("durationMinutes" in task) {
    update.duration_minutes = task.durationMinutes ?? null
  }

  if ("priority" in task) {
    update.priority = normalizePriority(task.priority)
  }

  if ("status" in task) {
    update.status = normalizeTaskStatus(task.status)
  }

  if ("scheduledFor" in task) {
    update.scheduled_for = task.scheduledFor ?? null
  }

  if ("isImmutable" in task && typeof task.isImmutable === "boolean") {
    update.is_immutable = task.isImmutable
  }

  if ("allDay" in task && typeof task.allDay === "boolean") {
    update.all_day = task.allDay
  }

  if ("calendarId" in task) {
    update.calendar_id = normalizeNullableText(task.calendarId)
  }

  if ("tags" in task) {
    update.tags = normalizeTags(task.tags)
  }

  return update
}

export function mapOnboardingTaskInputToTaskInsert(
  task: OnboardingTaskInput,
  userId: string,
  defaultDurationMinutes: number,
): TaskInsertRow {
  return {
    user_id: userId,
    title: task.title,
    description: normalizeNullableText(task.description),
    deadline: task.deadline ?? null,
    duration_minutes: task.durationMinutes ?? defaultDurationMinutes,
    priority: normalizePriority(task.priority),
    status: normalizeTaskStatus(task.status),
    scheduled_for: null,
    is_immutable: task.isImmutable ?? false,
    all_day: task.allDay ?? false,
    calendar_id: TASKS_CALENDAR_ID,
    tags: normalizeTags(task.tags),
  }
}

export function mapPreferencesRowToPreferences(row: UserPreferencesRow | null): UserPreferences | null {
  if (!row) {
    return null
  }

  return {
    userId: row.user_id,
    timezone: row.timezone,
    sleepPattern: normalizeNullableText(row.sleep_pattern),
    peakEnergyWindow: normalizeNullableText(row.peak_energy_window),
    procrastinationPattern: normalizeNullableText(row.procrastination_pattern),
    workdayStart: normalizeTimeValue(row.workday_start, "09:00"),
    workdayEnd: normalizeTimeValue(row.workday_end, "17:00"),
    defaultTaskDurationMinutes: row.default_task_duration_minutes,
    breakDurationMinutes: row.break_duration_minutes,
    preferredFocusBlockMinutes: row.preferred_focus_block_minutes,
    preferredCheckInMode: row.preferred_checkin_mode,
    calendarId: normalizeNullableText(row.calendar_id),
  }
}

export function mapPreferencesToUpsert(preferences: UserPreferences): UserPreferencesUpsertRow {
  return {
    user_id: preferences.userId,
    timezone: preferences.timezone,
    sleep_pattern: normalizeNullableText(preferences.sleepPattern),
    peak_energy_window: normalizeNullableText(preferences.peakEnergyWindow),
    procrastination_pattern: normalizeNullableText(preferences.procrastinationPattern),
    workday_start: preferences.workdayStart,
    workday_end: preferences.workdayEnd,
    default_task_duration_minutes: preferences.defaultTaskDurationMinutes,
    break_duration_minutes: preferences.breakDurationMinutes,
    preferred_focus_block_minutes: preferences.preferredFocusBlockMinutes,
    preferred_checkin_mode: preferences.preferredCheckInMode,
    calendar_id: normalizeNullableText(preferences.calendarId),
  }
}

export function mapScheduleEventRowToScheduleEvent(row: ScheduleEventRow): ScheduleEvent {
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    title: row.title,
    start: normalizeDateTime(row.starts_at) ?? row.starts_at,
    end: normalizeDateTime(row.ends_at) ?? row.ends_at,
    source: normalizeEventSource(row.source),
    status: row.status ? normalizeTaskStatus(row.status) : null,
    location: normalizeNullableText(row.location),
    externalEventId: normalizeNullableText(row.external_event_id),
    isImmutable: row.is_immutable,
    allDay: row.all_day,
    calendarId: normalizeNullableText(row.calendar_id),
  }
}

export function mapScheduleEventInputToScheduleEvent(
  event: ScheduleEventInput,
  userId: string,
): ScheduleEvent {
  return {
    id: event.id,
    userId,
    taskId: event.taskId ?? null,
    title: event.title,
    start: normalizeDateTime(event.start) ?? event.start,
    end: normalizeDateTime(event.end) ?? event.end,
    source: normalizeEventSource(event.source),
    status: event.status ?? null,
    location: normalizeNullableText(event.location),
    externalEventId: normalizeNullableText(event.externalEventId),
    isImmutable: event.isImmutable ?? false,
    allDay: event.allDay ?? false,
    calendarId: normalizeNullableText(event.calendarId),
  }
}

export function mapCheckInPayloadToInsert(
  payload: CheckInRequest,
  userId: string,
  outcome: "completed" | "missed" | "partial" = "partial",
): CheckInInsertRow {
  return {
    user_id: userId,
    task_id: payload.activeTaskId ?? null,
    mood: payload.mood ?? null,
    energy: payload.energy ?? null,
    outcome,
    note: normalizeNullableText(payload.note),
    blockers: payload.blockers?.map((blocker) => blocker.trim()).filter(Boolean) || [],
  }
}

export function getCheckInModeFromCount(checkInCount: number): PreferredCheckInMode {
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
