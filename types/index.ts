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
