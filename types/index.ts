// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

// Shared enum/value sets that must stay aligned with the SQL schema.
export type Priority = "low" | "medium" | "high"
export type TaskStatus = "todo" | "scheduled" | "completed" | "missed"
export type PreferredCheckInMode = "silent" | "quiet" | "gentle" | "active"
export type ScheduleEventSource = "task" | "calendar" | "focus"
export type CheckInMood = "good" | "okay" | "stuck"
export type CheckInOutcome = "completed" | "missed" | "partial"
export type CheckInEnergy = "low" | "medium" | "high"

// Raw database row shapes. These match Supabase column names and nullability exactly.
export interface UserRow {
  id: string
  email: string
  name: string
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
  calendar_id: string | null
  tags: string[]
}

export interface ScheduleEventRow {
  id: string
  user_id: string
  task_id: string | null
  title: string
  starts_at: string
  ends_at: string
  source: ScheduleEventSource
  status: TaskStatus | null
  location: string | null
  external_event_id: string | null
  created_at: string
  updated_at: string
  is_immutable: boolean
  calendar_id: string | null
}

export interface CheckInRow {
  id: string
  user_id: string
  task_id: string | null
  mood: CheckInMood | null
  energy: CheckInEnergy | null
  outcome: CheckInOutcome
  note: string | null
  blockers: string[]
  created_at: string
}

export interface MemoryLogRow {
  id: string
  user_id: string
  category: string
  insight: string
  confidence: number | null
  source: string
  created_at: string
}

// Database write payloads keep snake_case because they target Supabase directly.
export type UserPreferencesUpsertRow = Omit<UserPreferencesRow, "id" | "created_at" | "updated_at">
export type TaskInsertRow = Omit<TaskRow, "id" | "created_at" | "updated_at">
export type TaskUpdateRow = Partial<Omit<TaskInsertRow, "user_id">>
export type ScheduleEventInsertRow = Omit<ScheduleEventRow, "id" | "created_at" | "updated_at">
export type CheckInInsertRow = Omit<CheckInRow, "id" | "created_at">

// App/frontend-facing models. SQL rows stay snake_case, and mapper utilities convert them to camelCase.
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
  calendarId: string | null
  // `tags` is now persisted in Supabase on `public.tasks.tags`.
  // SQL rows use snake_case, while app-facing task objects use camelCase through the mapper layer.
  tags: string[]
}

export interface ScheduleEvent {
  id: string
  userId: string
  taskId: string | null
  title: string
  start: string
  end: string
  source: ScheduleEventSource
  status: TaskStatus | null
  location: string | null
  externalEventId: string | null
  isImmutable: boolean
  calendarId: string | null
}

export interface CheckIn {
  id: string
  userId: string
  taskId: string | null
  mood: CheckInMood | null
  energy: CheckInEnergy | null
  outcome: CheckInOutcome
  note: string | null
  blockers: string[]
  createdAt: string
}

// Request/response payloads intentionally separate API contracts from DB rows.
export interface CheckInRequest {
  mood?: CheckInMood
  energy?: CheckInEnergy
  blockers?: string[]
  note?: string
  // App-level convenience fields. These are not direct columns on `public.checkins`.
  completedTaskIds?: string[]
  activeTaskId?: string
}

export interface DashboardStats {
  tasks: number
  overdue: number
  unscheduled: number
  checkInMode: PreferredCheckInMode
}

export interface DashboardCurrentTask {
  id: string
  title: string
  status: TaskStatus
}

export interface DashboardResponse {
  stats: DashboardStats
  currentTask: DashboardCurrentTask | null
  events: ScheduleEvent[]
  tasks: Task[]
}

export interface CreateTaskRequest {
  title: string
  description?: string | null
  deadline?: string | null
  durationMinutes?: number | null
  priority?: Priority
  status?: TaskStatus
  isImmutable?: boolean
  calendarId?: string | null
  tags?: string[]
  scheduledFor?: string | null
}

export interface UpdateTaskRequest {
  title?: string
  description?: string | null
  deadline?: string | null
  durationMinutes?: number | null
  priority?: Priority
  status?: TaskStatus
  isImmutable?: boolean
  calendarId?: string | null
  tags?: string[]
  scheduledFor?: string | null
}

export interface TaskMutationResponse {
  success: true
  task: Task
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

export interface ScheduleEventInput {
  id: string
  title: string
  start: string
  end: string
  source: ScheduleEventSource
  taskId?: string | null
  status?: TaskStatus | null
  location?: string | null
  externalEventId?: string | null
  isImmutable?: boolean
  calendarId?: string | null
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
}

export interface SchedulePlanResult {
  plannerStatus: "stubbed" | "ready"
  proposedEvents: ScheduleEvent[]
  unscheduledTaskIds: string[]
  summary: string
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

export interface ReplanRequest {
  reason: string
  pendingTasks: Task[]
  existingEvents: ScheduleEventInput[]
  preferences?: UserPreferences
}

// ##### END BACKEND #####
