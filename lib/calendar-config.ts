import {
  TASKS_CALENDAR_COLOR,
  TASKS_CALENDAR_ID,
  TASKS_CALENDAR_NAME,
} from "@/lib/task-calendar-constants"

export type AppCalendarSource = "local" | "google" | "imported" | "task"

export type AppCalendarPreset = {
  id: string
  name: string
  color: string
  source: AppCalendarSource
  isVisibleByDefault: boolean
}

export const DEFAULT_TASKS_CALENDAR_ID = TASKS_CALENDAR_ID

export const APP_CALENDAR_PRESETS: AppCalendarPreset[] = [
  {
    id: DEFAULT_TASKS_CALENDAR_ID,
    name: TASKS_CALENDAR_NAME,
    color: TASKS_CALENDAR_COLOR,
    source: "task",
    isVisibleByDefault: true,
  },
  { id: "cal-1", name: "Personal", color: "#3b82f6", source: "local", isVisibleByDefault: true },
  { id: "cal-2", name: "Work", color: "#4ade80", source: "google", isVisibleByDefault: true },
  { id: "cal-3", name: "Northwestern Classes", color: "#fde047", source: "google", isVisibleByDefault: true },
  { id: "cal-4", name: "Project Vela", color: "#fb923c", source: "local", isVisibleByDefault: true },
  { id: "cal-5", name: "Social", color: "#22d3ee", source: "local", isVisibleByDefault: false },
  { id: "calendar-main", name: "Main", color: "#3b82f6", source: "local", isVisibleByDefault: true },
  { id: "calendar-projects", name: "Projects", color: "#fb923c", source: "local", isVisibleByDefault: true },
  { id: "calendar-academics", name: "Academics", color: "#fde047", source: "local", isVisibleByDefault: true },
  { id: "calendar-research", name: "Research", color: "#c084fc", source: "local", isVisibleByDefault: true },
  { id: "calendar-career", name: "Career", color: "#22d3ee", source: "local", isVisibleByDefault: true },
  { id: "calendar-personal", name: "Personal", color: "#34d399", source: "local", isVisibleByDefault: true },
]

export const INITIAL_SIDEBAR_CALENDAR_PRESETS = APP_CALENDAR_PRESETS.filter((calendar) => {
  return ["cal-tasks", "cal-1", "cal-2", "cal-3", "cal-4", "cal-5"].includes(calendar.id)
})

export const APP_CALENDAR_PRESET_MAP = Object.fromEntries(
  APP_CALENDAR_PRESETS.map((calendar) => [
    calendar.id,
    { name: calendar.name, color: calendar.color, source: calendar.source },
  ]),
) as Record<string, { name: string; color: string; source: AppCalendarSource }>

function normalizeCalendarName(name: string) {
  return name.trim().toLowerCase()
}

export function findTasksCalendarPreset(calendars: AppCalendarPreset[] = APP_CALENDAR_PRESETS) {
  return calendars.find((calendar) => {
    const normalized = normalizeCalendarName(calendar.name)
    return normalized === "tasks" || normalized === "task" || normalized === "task calendar"
  }) ?? null
}

export function getRequiredTasksCalendarPreset(calendars: AppCalendarPreset[] = APP_CALENDAR_PRESETS) {
  const preset = findTasksCalendarPreset(calendars)

  if (!preset) {
    throw new Error('No calendar named "Tasks" or "Task" is configured. Create that calendar before the secretary writes events.')
  }

  return preset
}
