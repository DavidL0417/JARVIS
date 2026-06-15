export type Priority = "low" | "medium" | "high"
export type TaskStatus = "todo" | "scheduled" | "completed" | "missed"
export type ScheduleEventStatus = TaskStatus | "unconfirmed"
export type PreferredCheckInMode = "silent" | "quiet" | "gentle" | "active"
export type ScheduleEventSource = "task" | "calendar" | "focus"
export type CheckInMood = "good" | "okay" | "stuck"
export type CheckInOutcome = "completed" | "missed" | "partial"
export type CheckInEnergy = "low" | "medium" | "high"
export type IntegrationProvider = "google" | "notion" | "canvas" | "caldav"
export type UserIntegrationStatus = "connected" | "needs_reauth" | "disconnected" | "error"
export type SourceConnectorId = "google_calendar" | "notion" | "gmail" | "canvas" | "caldav" | "apple_reminders"
export type SourceConnectorStatus = "ready" | "connected" | "auth_needed" | "missing_config" | "failed"
export type SyncOrigin = "local" | "gcal" | "caldav"
export type TaskSyncOrigin = "local" | "caldav" | "apple_reminders"
export type CalendarSource = "local" | "google" | "caldav" | "imported" | "task"
export type CalendarSyncPreference = "active" | "pending" | "ignored"
export type MemoryKind = "preference" | "task_context" | "source_observation" | "candidate" | "observation" | "rule"
export type MemoryLayer =
  | "operating_rules"
  | "planning_profile"
  | "durable_preferences"
  | "task_context"
  | "deadline_context"
  | "calendar_context"
  | "source_status"
  | "feedback_observations"
  | "candidate_memories"
export type MemoryImportance = "low" | "medium" | "high" | "critical"
export type MemoryStatus = "active" | "candidate" | "stale" | "superseded" | "archived"
// "imessage" and "raycast" are snapshot provenance only — deliberately NOT
// SourceConnectorIds, so no connector card renders. Both are operator-only intakes
// fed by a local reader on the operator's Mac. See docs/decisions/operator-only-imessage.md
// and docs/decisions/operator-only-raycast.md.
export type SourceKind = "notion" | "gmail" | "caldav" | "google_calendar" | "manual" | "system" | "canvas" | "apple_reminders" | "imessage" | "raycast"
export type SourceFreshness = "fresh" | "partial" | "stale" | "failed"
export type SourceFileStatus = "uploading" | "ready" | "processing" | "processed" | "failed"
export type SourceCandidateKind = "task" | "deadline" | "event" | "routine" | "preference" | "note"
export type SourceCandidateStatus = "pending" | "approved" | "dismissed"
export type DailyPlanStatus = "draft" | "ready" | "error" | "superseded"
export type AssistantToolStatus = "completed" | "clarification" | "error" | "pending_approval" | "cancelled"

export interface UserRow {
  id: string
  email: string
  name: string
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface UserPreferencesRow {
  id: string
  user_id: string
  timezone: string
  sleep_pattern: string | null
  peak_energy_window: string | null
  procrastination_pattern: string | null
  workday_start: string
  workday_end: string
  default_task_duration_minutes: number
  break_duration_minutes: number
  preferred_focus_block_minutes: number | null
  preferred_checkin_mode: PreferredCheckInMode
  calendar_id: string | null
  planner_horizon_days: number | null
  created_at: string
  updated_at: string
}

export interface UserCalendarRow {
  id: string
  user_id: string
  calendar_key: string
  name: string
  color: string
  source: CalendarSource
  google_calendar_id: string | null
  remote_name: string | null
  is_visible: boolean
  is_immutable: boolean
  sync_preference: CalendarSyncPreference
  is_task_calendar: boolean
  created_at: string
  updated_at: string
}

export interface TaskRow {
  id: string
  user_id: string
  title: string
  description: string | null
  deadline: string | null
  duration_minutes: number | null
  priority: Priority
  status: TaskStatus
  scheduled_for: string | null
  created_at: string
  updated_at: string
  is_immutable: boolean
  all_day: boolean
  calendar_id: string | null
  tags: string[]
  source_snapshot_id: string | null
  source_candidate_id: string | null
  plan_id: string | null
  external_task_id: string | null
  last_synced_from: TaskSyncOrigin
}

export interface ScheduleEventRow {
  id: string
  user_id: string
  task_id: string | null
  title: string
  starts_at: string
  ends_at: string
  source: ScheduleEventSource
  priority: Priority
  status: ScheduleEventStatus | null
  location: string | null
  external_event_id: string | null
  gcal_event_id: string | null
  last_synced_from: SyncOrigin
  created_at: string
  updated_at: string
  is_immutable: boolean
  is_checked_in: boolean
  all_day: boolean
  calendar_id: string | null
  plan_id: string | null
}

export interface CheckInRow {
  id: string
  user_id: string
  task_id: string | null
  event_id: string | null
  mood: CheckInMood | null
  energy: CheckInEnergy | null
  outcome: CheckInOutcome
  note: string | null
  blockers: string[]
  created_at: string
}

export interface UserIntegrationRow {
  id: string
  user_id: string
  provider: IntegrationProvider
  provider_account_email: string | null
  provider_user_id: string | null
  status: UserIntegrationStatus
  selected_calendar_id: string | null
  selected_source_id?: string | null
  selected_source_name?: string | null
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

export interface SourceConnector {
  id: SourceConnectorId
  status: SourceConnectorStatus
  detail: string
  account: string | null
  canRun: boolean
  enabled: boolean
  selectedSourceId: string | null
  selectedSourceName: string | null
}

export interface IntegrationTokenRow {
  id: string
  user_id: string
  provider: IntegrationProvider
  access_token: string | null
  refresh_token: string | null
  expires_at: string | null
  scope: string | null
  created_at: string
  updated_at: string
}

export interface MemoryItemRow {
  id: string
  user_id: string
  kind: MemoryKind
  layer: MemoryLayer
  category: string
  content: string
  importance: MemoryImportance
  importance_note: string | null
  confidence: number | null
  source_label: string
  source_ref: string | null
  payload: Record<string, unknown>
  status: MemoryStatus
  supersedes_id: string | null
  expires_at: string | null
  created_at: string
  updated_at: string
}

export type MemoryLogRow = MemoryItemRow

export interface SourceSnapshotRow {
  id: string
  user_id: string
  source: SourceKind
  source_ref: string | null
  captured_at: string
  freshness: SourceFreshness
  summary: string
  payload: Record<string, unknown>
  created_at: string
}

export interface SourceFileRow {
  id: string
  user_id: string
  source: SourceKind
  source_ref: string | null
  file_name: string
  mime_type: string
  storage_path: string
  size_bytes: number
  status: SourceFileStatus
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface SourceCandidateRow {
  id: string
  user_id: string
  source_snapshot_id: string | null
  source_file_id: string | null
  kind: SourceCandidateKind
  title: string
  description: string | null
  course: string | null
  due_at: string | null
  duration_minutes: number | null
  priority: Priority
  confidence: number | null
  evidence: string | null
  payload: Record<string, unknown>
  status: SourceCandidateStatus
  approved_task_id: string | null
  created_at: string
  updated_at: string
}

export interface DailyPlanRow {
  id: string
  user_id: string
  horizon_start: string
  horizon_end: string
  status: DailyPlanStatus
  summary: string
  now_item: Record<string, unknown> | null
  next_items: Record<string, unknown>[]
  risk_items: Record<string, unknown>[]
  tradeoffs: Record<string, unknown>[]
  source_coverage: Record<string, unknown>[]
  command: string | null
  model: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface ChangeLogRow {
  id: string
  user_id: string
  actor: "user" | "assistant" | "system"
  action: string
  target_table: string | null
  target_id: string | null
  summary: string
  before_value: Record<string, unknown> | null
  after_value: Record<string, unknown> | null
  source_label: string | null
  created_at: string
}

export interface AssistantToolRunRow {
  id: string
  user_id: string
  thread_id: string | null
  message_id: string | null
  tool_name: string
  status: AssistantToolStatus
  summary: string
  payload: Record<string, unknown>
  requires_approval: boolean
  approved_at: string | null
  executed_at: string | null
  cancelled_at: string | null
  error_message: string | null
  created_at: string
}

export type UserPreferencesUpsertRow = Omit<UserPreferencesRow, "id" | "created_at" | "updated_at">
export type TaskInsertRow = Omit<
  TaskRow,
  | "id"
  | "created_at"
  | "updated_at"
  | "source_snapshot_id"
  | "source_candidate_id"
  | "plan_id"
  | "external_task_id"
  | "last_synced_from"
> & {
  source_snapshot_id?: string | null
  source_candidate_id?: string | null
  plan_id?: string | null
  external_task_id?: string | null
  last_synced_from?: TaskSyncOrigin
}
export type TaskUpdateRow = Partial<Omit<TaskInsertRow, "user_id">>
export type ScheduleEventInsertRow = Omit<ScheduleEventRow, "id" | "created_at" | "updated_at" | "plan_id"> & {
  plan_id?: string | null
}
export type CheckInInsertRow = Omit<CheckInRow, "id" | "created_at" | "event_id"> & { event_id?: string | null }
export type UserIntegrationUpsertRow = Omit<UserIntegrationRow, "id" | "created_at" | "updated_at">
export type UserCalendarUpsertRow = Omit<UserCalendarRow, "id" | "created_at" | "updated_at">

export interface UserProfile {
  id: string
  email: string
  name: string
  avatarUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface UserPreferences {
  userId: string
  timezone: string
  sleepPattern: string | null
  peakEnergyWindow: string | null
  procrastinationPattern: string | null
  workdayStart: string
  workdayEnd: string
  defaultTaskDurationMinutes: number
  breakDurationMinutes: number
  preferredFocusBlockMinutes: number | null
  preferredCheckInMode: PreferredCheckInMode
  calendarId: string | null
  plannerHorizonDays: number
}

export interface UserCalendar {
  id: string
  userId: string
  calendarKey: string
  name: string
  color: string
  source: CalendarSource
  googleCalendarId: string | null
  remoteName: string | null
  isVisible: boolean
  isImmutable: boolean
  syncPreference: CalendarSyncPreference
  isTaskCalendar: boolean
  createdAt: string
  updatedAt: string
}

export interface Task {
  id: string
  userId: string
  title: string
  description: string | null
  deadline: string | null
  durationMinutes: number | null
  priority: Priority
  status: TaskStatus
  scheduledFor: string | null
  isImmutable: boolean
  allDay: boolean
  calendarId: string | null
  tags: string[]
  sourceSnapshotId: string | null
  sourceCandidateId: string | null
  planId: string | null
  externalTaskId: string | null
  lastSyncedFrom: TaskSyncOrigin
}

export interface ScheduleEvent {
  id: string
  userId: string
  taskId: string | null
  title: string
  start: string
  end: string
  source: ScheduleEventSource
  priority: Priority
  status: ScheduleEventStatus | null
  location: string | null
  externalEventId: string | null
  gcalEventId: string | null
  lastSyncedFrom: SyncOrigin
  isImmutable: boolean
  isCheckedIn: boolean
  allDay: boolean
  calendarId: string | null
  planId: string | null
}

export interface UserIntegration {
  id: string
  userId: string
  provider: IntegrationProvider
  providerAccountEmail: string | null
  providerUserId: string | null
  status: UserIntegrationStatus
  selectedCalendarId: string | null
  selectedSourceId: string | null
  selectedSourceName: string | null
  lastSyncedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface GoogleCalendarExtendedProperties {
  priority: Priority
  isImmutable: boolean
  isCheckedIn: boolean
  lastSyncedFrom: SyncOrigin
  taskId: string | null
  localEventId: string | null
}

export interface CheckIn {
  id: string
  userId: string
  taskId: string | null
  eventId: string | null
  mood: CheckInMood | null
  energy: CheckInEnergy | null
  outcome: CheckInOutcome
  note: string | null
  blockers: string[]
  createdAt: string
}

export interface MemoryEntrySummary {
  id: string
  kind: MemoryKind
  layer: MemoryLayer
  category: string
  insight: string
  importance: MemoryImportance
  importanceNote: string | null
  source: string
  confidence: number | null
  payload: Record<string, unknown>
  createdAt: string
}

export interface SourceSnapshotSummary {
  id: string
  source: SourceKind
  freshness: SourceFreshness
  summary: string
  capturedAt: string
}

export interface SourceFileSummary {
  id: string
  source: SourceKind
  sourceRef: string | null
  fileName: string
  mimeType: string
  storagePath: string
  sizeBytes: number
  status: SourceFileStatus
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

export interface SourceCandidate {
  id: string
  userId: string
  sourceSnapshotId: string | null
  sourceFileId: string | null
  kind: SourceCandidateKind
  title: string
  description: string | null
  course: string | null
  dueAt: string | null
  durationMinutes: number | null
  priority: Priority
  confidence: number | null
  evidence: string | null
  payload: Record<string, unknown>
  status: SourceCandidateStatus
  approvedTaskId: string | null
  createdAt: string
  updatedAt: string
}

export interface DailyPlanNowItem {
  title: string
  why: string
  start: string | null
  end: string | null
  taskId: string | null
  eventId: string | null
}

export interface DailyPlanListItem {
  title: string
  start: string | null
  end: string | null
  kind: "task" | "event" | "routine" | "break"
}

export interface DailyPlanRiskItem {
  title: string
  detail: string
  severity: "low" | "medium" | "high"
  taskId?: string | null
  eventId?: string | null
}

export interface SourceCoverageItem {
  label: string
  status: SourceFreshness | "connected" | "missing"
  detail: string
}

export interface DailyPlan {
  id: string
  userId: string
  horizonStart: string
  horizonEnd: string
  status: DailyPlanStatus
  summary: string
  nowItem: DailyPlanNowItem | null
  nextItems: DailyPlanListItem[]
  riskItems: DailyPlanRiskItem[]
  tradeoffs: string[]
  sourceCoverage: SourceCoverageItem[]
  command: string | null
  model: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

export interface AvailabilityContext {
  timezone: string
  workdayStart: string
  workdayEnd: string
  peakEnergyWindow: string | null
  sleepPattern: string | null
  procrastinationPattern: string | null
  preferredCheckInMode: PreferredCheckInMode
  defaultTaskDurationMinutes: number
  breakDurationMinutes: number
  preferredFocusBlockMinutes: number | null
  availabilitySummary: string
}

export interface AvailabilityWindow {
  start: string
  end: string
  localDay: string
  durationMinutes: number
}

export interface AssistantContextData {
  availability: AvailabilityContext
  availabilityWindows: AvailabilityWindow[]
  memoryEntries: MemoryEntrySummary[]
  sourceSnapshots: SourceSnapshotSummary[]
  memorySummary: string
  layeredContextMarkdown?: string
  latestDailyPlan?: DailyPlan | null
  pendingCandidateCount?: number
  recentChangeLogSummaries?: string[]
}

export interface AssistantToolCallResult {
  id: string
  tool: string
  status: AssistantToolStatus
  summary: string
  requiresApproval?: boolean
  errorMessage?: string | null
}

export interface AssistantConversationEntry {
  role: "user" | "assistant"
  text: string
}

export interface AssistantMessageRequest {
  message: string
  now?: string | null
  timezone?: string | null
  history?: AssistantConversationEntry[]
}

export interface AssistantMessageResponse {
  ok: boolean
  reply: string
  toolCalls: AssistantToolCallResult[]
  needsRefresh: boolean
  clarification: string | null
  context?: AssistantContextData
  error?: string
}

export interface AssistantContextResponse {
  ok: boolean
  context: AssistantContextData
  error?: string
}

export interface CheckInRequest {
  mood?: CheckInMood
  energy?: CheckInEnergy
  blockers?: string[]
  note?: string
  completedTaskIds?: string[]
  activeTaskId?: string
  eventId?: string | null
}

export interface CheckInApprovalItem {
  event: ScheduleEvent
}

export interface CheckInApprovalListResponse {
  success: true
  items: CheckInApprovalItem[]
  totalPending: number
  visibleLimit: number
}

export interface SaveCheckInApprovalRequest {
  eventId: string
  priority: Priority
  isImmutable: boolean
}

export interface SaveCheckInApprovalResponse {
  success: true
  event: ScheduleEvent
}

export interface DashboardStats {
  tasks: number
  overdue: number
  unscheduled: number
  checkInMode: PreferredCheckInMode
  memories: number
  sources: number
}

export interface DashboardCurrentTask {
  id: string
  title: string
  status: TaskStatus
}

export interface DashboardReentry {
  gapDays: number
  unconfirmedCount: number
  tasksReturnedToTodo: number
  autoImportedCount: number
  passedDeadlines: string[]
}

export interface DashboardResponse {
  stats: DashboardStats
  currentTask: DashboardCurrentTask | null
  tasks: Task[]
  events: ScheduleEvent[]
  memories: MemoryEntrySummary[]
  integrations: UserIntegration[]
  sourceConnectors: SourceConnector[]
  sources: SourceSnapshotSummary[]
  sourceFiles: SourceFileSummary[]
  sourceCandidates: SourceCandidate[]
  dailyPlan: DailyPlan | null
  reentry: DashboardReentry | null
}

export interface CreateTaskRequest {
  title: string
  description?: string | null
  deadline?: string | null
  durationMinutes?: number | null
  priority?: Priority
  status?: TaskStatus
  isImmutable?: boolean
  allDay?: boolean
  calendarId?: string | null
  tags?: string[]
  scheduledFor?: string | null
  sourceSnapshotId?: string | null
  sourceCandidateId?: string | null
  planId?: string | null
}

export interface UpdateTaskRequest {
  title?: string
  description?: string | null
  deadline?: string | null
  durationMinutes?: number | null
  priority?: Priority
  status?: TaskStatus
  isImmutable?: boolean
  allDay?: boolean
  calendarId?: string | null
  tags?: string[]
  scheduledFor?: string | null
  sourceSnapshotId?: string | null
  sourceCandidateId?: string | null
  planId?: string | null
}

export interface TaskMutationResponse {
  success: true
  task: Task
  externalWrite?: {
    source: "canvas"
    status: "completed" | "failed" | "skipped"
    summary: string
    error?: string | null
  } | null
}

export interface DeleteTaskResponse {
  success: true
  id: string
}

export interface OnboardingPreferencesInput {
  timezone?: string
  sleepPattern?: string | null
  peakEnergyWindow?: string | null
  procrastinationPattern?: string | null
  workdayStart?: string
  workdayEnd?: string
  defaultTaskDurationMinutes?: number
  breakDurationMinutes?: number
  preferredFocusBlockMinutes?: number | null
  preferredCheckInMode?: PreferredCheckInMode
  calendarId?: string | null
}

export interface OnboardingTaskInput {
  title: string
  description?: string | null
  deadline?: string | null
  durationMinutes?: number | null
  priority?: Priority
  status?: TaskStatus
  isImmutable?: boolean
  allDay?: boolean
  calendarId?: string | null
  tags?: string[]
}

export interface OnboardingRequest {
  name: string
  timezone: string
  goals: string[]
  tasks: OnboardingTaskInput[]
  preferences?: OnboardingPreferencesInput
}

export interface OnboardingResponse {
  success: true
  userId: string
  preferenceId: string | null
  taskIds: string[]
  taskCount: number
}

export interface UpdatePreferencesRequest {
  timezone?: string
  sleepPattern?: string | null
  peakEnergyWindow?: string | null
  procrastinationPattern?: string | null
  workdayStart?: string
  workdayEnd?: string
  defaultTaskDurationMinutes?: number
  breakDurationMinutes?: number
  preferredFocusBlockMinutes?: number | null
  preferredCheckInMode?: PreferredCheckInMode
  calendarId?: string | null
  plannerHorizonDays?: number
}

export interface PreferencesResponse {
  success: true
  preferences: UserPreferences
}

export interface CreateCalendarRequest {
  name: string
  color?: string | null
  source?: CalendarSource
  isImmutable: boolean
}

export interface UpdateCalendarRequest {
  name?: string
  color?: string
  isVisible?: boolean
  isImmutable?: boolean
  syncPreference?: CalendarSyncPreference
}

export interface CalendarMutationResponse {
  success: true
  calendar: UserCalendar
}

export interface CalendarListResponse {
  success: true
  calendars: UserCalendar[]
}

export interface ScheduleEventInput {
  id: string
  title: string
  start: string
  end: string
  source: ScheduleEventSource
  priority?: Priority
  taskId?: string | null
  status?: ScheduleEventStatus | null
  location?: string | null
  externalEventId?: string | null
  gcalEventId?: string | null
  lastSyncedFrom?: SyncOrigin
  isImmutable?: boolean
  isCheckedIn?: boolean
  allDay?: boolean
  calendarId?: string | null
  planId?: string | null
}

export interface ScheduleRequest {
  taskIds: string[]
  hardEvents: ScheduleEventInput[]
}

export interface SchedulePreparationContext {
  userId: string
  tasks: Task[]
  preferences: UserPreferences | null
  hardEvents: ScheduleEvent[]
  memoryEntries?: MemoryEntrySummary[]
  sourceSnapshots?: SourceSnapshotSummary[]
  command?: string | null
  layeredContextMarkdown?: string | null
  sourceStatus?: SourceCoverageItem[]
  plannerTradeoffContext?: string[]
}

export interface SchedulePlanResult {
  plannerStatus: "stubbed" | "ready"
  proposedEvents: ScheduleEvent[]
  unscheduledTaskIds: string[]
  summary: string
  tradeoffNotes: string[]
}

export interface ScheduleResponse {
  success: true
  message: string
  context: {
    userId: string
    taskCount: number
    hardEventCount: number
    hasPreferences: boolean
  }
  schedule: SchedulePlanResult
}

export interface ScheduleEventUpdateRequest {
  priority?: Priority
  isImmutable?: boolean
}

export interface ScheduleEventUpdateResponse {
  success: true
  event: ScheduleEvent
}

export interface GoogleCalendarSyncResponse {
  success: boolean
  connected: boolean
  needsAuthorization?: boolean
  events: ScheduleEvent[]
  calendars: UserCalendar[]
  error?: string
}
