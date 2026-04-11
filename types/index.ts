// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

export type Priority = "low" | "medium" | "high"

export type TaskStatus = "todo" | "scheduled" | "completed" | "missed"

export type CheckInStatus = "silent" | "quiet" | "gentle" | "active"

export interface Task {
  id: string
  title: string
  description?: string
  priority: Priority
  status: TaskStatus
  dueAt?: string | null
  scheduledFor?: string | null
  estimateMinutes?: number | null
  tags?: string[]
}

export interface UserPreferences {
  timezone: string
  sleepPattern?: string
  peakEnergyWindow?: string
  procrastinationPattern?: string
  workdayStart: string
  workdayEnd: string
  defaultTaskDurationMinutes: number
  breakDurationMinutes: number
  calendarId?: string
  preferredFocusBlockMinutes?: number
  preferredCheckInMode?: CheckInStatus
}

export interface ScheduleEvent {
  id: string
  title: string
  start: string
  end: string
  source: "task" | "calendar" | "focus"
  status?: TaskStatus
  location?: string | null
}

export interface CheckInPayload {
  mood?: "good" | "okay" | "stuck"
  energy?: Priority
  completedTaskIds?: string[]
  blockers?: string[]
  note?: string
  activeTaskId?: string
}

export interface DashboardStats {
  tasks: number
  overdue: number
  unscheduled: number
  checkins: CheckInStatus
}

export interface DashboardCurrentTask {
  id?: string
  title: string
  status: TaskStatus
}

export interface DashboardResponse {
  stats: DashboardStats
  currentTask: DashboardCurrentTask | null
  events: ScheduleEvent[]
}

export interface OnboardingTaskInput {
  title: string
  description?: string
  deadline?: string | null
  durationMinutes?: number | null
  priority?: Priority
  status?: TaskStatus
}

export interface OnboardingResponse {
  success: true
  userId: string
  preferenceId: string | null
  taskIds: string[]
  taskCount: number
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

// ##### END BACKEND #####
