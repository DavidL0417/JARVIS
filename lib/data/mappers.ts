import { TASKS_CALENDAR_ID } from "@/lib/task-calendar-constants"
import type {
  CalendarSource,
  CalendarSyncPreference,
  CheckInInsertRow,
  CheckInRequest,
  DailyPlan,
  DailyPlanListItem,
  DailyPlanNowItem,
  DailyPlanRiskItem,
  DailyPlanRow,
  MemoryEntrySummary,
  MemoryImportance,
  MemoryItemRow,
  OnboardingTaskInput,
  PreferredCheckInMode,
  Priority,
  ScheduleEvent,
  ScheduleEventInput,
  ScheduleEventInsertRow,
  ScheduleEventRow,
  ScheduleEventSource,
  SourceSnapshotRow,
  SourceSnapshotSummary,
  SourceCandidate,
  SourceCandidateRow,
  SourceCoverageItem,
  SourceFileRow,
  SourceFileSummary,
  SyncOrigin,
  TaskSyncOrigin,
  Task,
  TaskInsertRow,
  TaskRow,
  TaskStatus,
  TaskUpdateRow,
  UserCalendar,
  UserCalendarRow,
  UserIntegration,
  UserIntegrationRow,
  UserPreferences,
  UserPreferencesRow,
  UserPreferencesUpsertRow,
  UserProfile,
  UserRow,
} from "@/types"

export const USER_PROFILE_SELECT = "id, email, name, avatar_url, created_at, updated_at"
export const PREFERENCES_SELECT =
  "id, user_id, timezone, sleep_pattern, peak_energy_window, procrastination_pattern, workday_start, workday_end, default_task_duration_minutes, break_duration_minutes, preferred_focus_block_minutes, preferred_checkin_mode, calendar_id, planner_horizon_days, created_at, updated_at"
export const TASK_SELECT =
  "id, user_id, title, description, deadline, duration_minutes, priority, status, scheduled_for, created_at, updated_at, is_immutable, all_day, calendar_id, tags, source_snapshot_id, source_candidate_id, plan_id, external_task_id, last_synced_from"
export const SCHEDULE_EVENT_SELECT =
  "id, user_id, task_id, title, starts_at, ends_at, source, priority, status, location, external_event_id, gcal_event_id, last_synced_from, created_at, updated_at, is_immutable, is_checked_in, all_day, calendar_id, plan_id"
export const USER_CALENDAR_SELECT =
  "id, user_id, calendar_key, name, color, source, google_calendar_id, remote_name, is_visible, is_immutable, sync_preference, is_task_calendar, created_at, updated_at"
export const USER_INTEGRATION_SELECT =
  "id, user_id, provider, provider_account_email, provider_user_id, status, selected_calendar_id, last_synced_at, created_at, updated_at"
export const MEMORY_ITEM_SELECT =
  "id, user_id, kind, layer, category, content, importance, importance_note, confidence, source_label, source_ref, payload, status, supersedes_id, expires_at, created_at, updated_at"
export const SOURCE_SNAPSHOT_SELECT =
  "id, user_id, source, source_ref, captured_at, freshness, summary, payload, created_at"
export const SOURCE_FILE_SELECT =
  "id, user_id, source, source_ref, file_name, mime_type, storage_path, size_bytes, status, error_message, created_at, updated_at"
export const SOURCE_CANDIDATE_SELECT =
  "id, user_id, source_snapshot_id, source_file_id, kind, title, description, course, due_at, duration_minutes, priority, confidence, evidence, payload, status, approved_task_id, created_at, updated_at"
export const DAILY_PLAN_SELECT =
  "id, user_id, horizon_start, horizon_end, status, summary, now_item, next_items, risk_items, tradeoffs, source_coverage, command, model, error_message, created_at, updated_at"
export const ASSISTANT_TOOL_RUN_SELECT =
  "id, user_id, thread_id, message_id, tool_name, status, summary, payload, requires_approval, approved_at, executed_at, cancelled_at, error_message, created_at"

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
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()
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

function normalizeSyncOrigin(value: SyncOrigin | string | null | undefined): SyncOrigin {
  if (value === "gcal") {
    return value
  }

  if (value === "caldav") {
    return value
  }

  return "local"
}

function normalizeTaskSyncOrigin(value: TaskSyncOrigin | string | null | undefined): TaskSyncOrigin {
  if (value === "caldav" || value === "apple_reminders") {
    return value
  }
  return "local"
}

function normalizeCalendarSource(value: CalendarSource | string | null | undefined): CalendarSource {
  if (value === "google" || value === "caldav" || value === "imported" || value === "task") {
    return value
  }

  return "local"
}

function normalizeCalendarSyncPreference(
  value: CalendarSyncPreference | string | null | undefined,
): CalendarSyncPreference {
  if (value === "pending" || value === "ignored") {
    return value
  }

  return "active"
}

function normalizeMemoryImportance(value: MemoryImportance | string | null | undefined): MemoryImportance {
  if (value === "low" || value === "high" || value === "critical") {
    return value
  }

  return "medium"
}

function normalizeTimeValue(value: string | null | undefined, fallback: string) {
  return value?.slice(0, 5) || fallback
}

function normalizeJsonArray<T>(value: unknown, fallback: T[] = []): T[] {
  return Array.isArray(value) ? (value as T[]) : fallback
}

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
    sourceSnapshotId: row.source_snapshot_id,
    sourceCandidateId: row.source_candidate_id,
    planId: row.plan_id,
    externalTaskId: row.external_task_id,
    lastSyncedFrom: normalizeTaskSyncOrigin(row.last_synced_from),
  }
}

export function mapUserRowToUserProfile(row: UserRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: normalizeNullableText(row.avatar_url),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapUserIntegrationRowToUserIntegration(row: UserIntegrationRow): UserIntegration {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerAccountEmail: normalizeNullableText(row.provider_account_email),
    providerUserId: normalizeNullableText(row.provider_user_id),
    status: row.status,
    selectedCalendarId: normalizeNullableText(row.selected_calendar_id),
    selectedSourceId: normalizeNullableText(row.selected_source_id),
    selectedSourceName: normalizeNullableText(row.selected_source_name),
    lastSyncedAt: normalizeNullableText(row.last_synced_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapUserCalendarRowToUserCalendar(row: UserCalendarRow): UserCalendar {
  return {
    id: row.id,
    userId: row.user_id,
    calendarKey: row.calendar_key,
    name: row.name,
    color: row.color,
    source: normalizeCalendarSource(row.source),
    googleCalendarId: normalizeNullableText(row.google_calendar_id),
    remoteName: normalizeNullableText(row.remote_name),
    isVisible: row.is_visible,
    isImmutable: row.is_immutable,
    syncPreference: normalizeCalendarSyncPreference(row.sync_preference),
    isTaskCalendar: row.is_task_calendar,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    source_snapshot_id: task.sourceSnapshotId,
    source_candidate_id: task.sourceCandidateId,
    plan_id: task.planId,
    external_task_id: task.externalTaskId,
    last_synced_from: task.lastSyncedFrom,
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

  if ("sourceSnapshotId" in task) {
    update.source_snapshot_id = task.sourceSnapshotId ?? null
  }

  if ("sourceCandidateId" in task) {
    update.source_candidate_id = task.sourceCandidateId ?? null
  }

  if ("planId" in task) {
    update.plan_id = task.planId ?? null
  }

  if ("externalTaskId" in task) {
    update.external_task_id = task.externalTaskId ?? null
  }

  if ("lastSyncedFrom" in task && typeof task.lastSyncedFrom === "string") {
    update.last_synced_from = normalizeTaskSyncOrigin(task.lastSyncedFrom)
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
    source_snapshot_id: null,
    source_candidate_id: null,
    plan_id: null,
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
    plannerHorizonDays: row.planner_horizon_days ?? 28,
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
    planner_horizon_days: preferences.plannerHorizonDays,
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
    priority: normalizePriority(row.priority),
    status: row.status ? normalizeTaskStatus(row.status) : null,
    location: normalizeNullableText(row.location),
    externalEventId: normalizeNullableText(row.external_event_id),
    gcalEventId: normalizeNullableText(row.gcal_event_id),
    lastSyncedFrom: normalizeSyncOrigin(row.last_synced_from),
    isImmutable: row.is_immutable,
    isCheckedIn: row.is_checked_in ?? false,
    allDay: row.all_day,
    calendarId: normalizeNullableText(row.calendar_id),
    planId: row.plan_id,
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
    priority: normalizePriority(event.priority),
    status: event.status ?? null,
    location: normalizeNullableText(event.location),
    externalEventId: normalizeNullableText(event.externalEventId),
    gcalEventId: normalizeNullableText(event.gcalEventId),
    lastSyncedFrom: normalizeSyncOrigin(event.lastSyncedFrom),
    isImmutable: event.isImmutable ?? false,
    isCheckedIn: event.isCheckedIn ?? false,
    allDay: event.allDay ?? false,
    calendarId: normalizeNullableText(event.calendarId),
    planId: event.planId ?? null,
  }
}

export function mapScheduleEventToInsert(event: ScheduleEvent, userId = event.userId): ScheduleEventInsertRow {
  return {
    user_id: userId,
    task_id: event.taskId,
    title: event.title,
    starts_at: event.start,
    ends_at: event.end,
    source: normalizeEventSource(event.source),
    priority: normalizePriority(event.priority),
    status: event.status,
    location: normalizeNullableText(event.location),
    external_event_id: normalizeNullableText(event.externalEventId),
    gcal_event_id: normalizeNullableText(event.gcalEventId),
    last_synced_from: normalizeSyncOrigin(event.lastSyncedFrom),
    is_immutable: event.isImmutable,
    is_checked_in: event.isCheckedIn,
    all_day: event.allDay,
    calendar_id: normalizeNullableText(event.calendarId),
    plan_id: event.planId,
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
    event_id: payload.eventId ?? null,
    mood: payload.mood ?? null,
    energy: payload.energy ?? null,
    outcome,
    note: normalizeNullableText(payload.note),
    blockers: payload.blockers?.map((blocker) => blocker.trim()).filter(Boolean) || [],
  }
}

export function mapMemoryItemRowToSummary(row: MemoryItemRow): MemoryEntrySummary {
  return {
    id: row.id,
    kind: row.kind,
    layer: row.layer,
    category: row.category,
    insight: row.content,
    importance: normalizeMemoryImportance(row.importance),
    importanceNote: normalizeNullableText(row.importance_note),
    source: row.source_label,
    confidence: row.confidence,
    payload: row.payload ?? {},
    createdAt: row.created_at,
  }
}

export function mapSourceSnapshotRowToSummary(row: SourceSnapshotRow): SourceSnapshotSummary {
  return {
    id: row.id,
    source: row.source,
    freshness: row.freshness,
    summary: row.summary,
    capturedAt: row.captured_at,
  }
}

export function mapSourceFileRowToSummary(row: SourceFileRow): SourceFileSummary {
  return {
    id: row.id,
    source: row.source,
    sourceRef: normalizeNullableText(row.source_ref),
    fileName: row.file_name,
    mimeType: row.mime_type,
    storagePath: row.storage_path,
    sizeBytes: row.size_bytes,
    status: row.status,
    errorMessage: normalizeNullableText(row.error_message),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapSourceCandidateRowToCandidate(row: SourceCandidateRow): SourceCandidate {
  return {
    id: row.id,
    userId: row.user_id,
    sourceSnapshotId: row.source_snapshot_id,
    sourceFileId: row.source_file_id,
    kind: row.kind,
    title: row.title,
    description: normalizeNullableText(row.description),
    course: normalizeNullableText(row.course),
    dueAt: normalizeDateTime(row.due_at),
    durationMinutes: row.duration_minutes,
    priority: normalizePriority(row.priority),
    confidence: row.confidence,
    evidence: normalizeNullableText(row.evidence),
    payload: row.payload ?? {},
    status: row.status,
    approvedTaskId: row.approved_task_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapDailyPlanRowToDailyPlan(row: DailyPlanRow): DailyPlan {
  return {
    id: row.id,
    userId: row.user_id,
    horizonStart: normalizeDateTime(row.horizon_start) ?? row.horizon_start,
    horizonEnd: normalizeDateTime(row.horizon_end) ?? row.horizon_end,
    status: row.status,
    summary: row.summary,
    nowItem: row.now_item as DailyPlanNowItem | null,
    nextItems: normalizeJsonArray<DailyPlanListItem>(row.next_items),
    riskItems: normalizeJsonArray<DailyPlanRiskItem>(row.risk_items),
    tradeoffs: normalizeJsonArray<string>(row.tradeoffs),
    sourceCoverage: normalizeJsonArray<SourceCoverageItem>(row.source_coverage),
    command: normalizeNullableText(row.command),
    model: normalizeNullableText(row.model),
    errorMessage: normalizeNullableText(row.error_message),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
