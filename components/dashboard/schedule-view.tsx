"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { CalendarPlus, ChevronLeft, ChevronRight, Loader2, MapPin, RefreshCw, X } from "lucide-react"
import { fetchGoogleEvents } from "@/lib/supabase/auth-actions"
import {
  buildTaskReminderDescription,
  getTaskDueTimeLabel,
  TASKS_CALENDAR_ID,
} from "@/lib/task-calendar-constants"
import type { ScheduleEvent, Task } from "@/types"
import type { Calendar } from "./calendars-sidebar"
import { TaskQueuePopover } from "./task-queue-popover"

type ViewMode = "1day" | "3days" | "7days" | "1month"
type SyncStatus = "idle" | "syncing" | "success" | "error"

export interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  source: "google" | "local" | "task"
  isReadOnly: boolean
  calendarId: string
  allDay: boolean
  location?: string
  color: "mint" | "blue" | "yellow" | "orange" | "purple" | "cyan"
  day: number
  startHour: number
  duration: number
  renderVariant?: "default" | "task-due"
  detail?: string
  dueTimeLabel?: string
}

const fallbackHues: Record<CalendarEvent["color"], number> = {
  mint: 165,
  blue: 240,
  yellow: 95,
  orange: 50,
  purple: 290,
  cyan: 200,
}

function fallbackEventStyle(color: CalendarEvent["color"]) {
  const hue = fallbackHues[color]
  return {
    backgroundColor: `oklch(0.46 0.07 ${hue} / 0.55)`,
    color: `oklch(0.95 0.01 ${hue})`,
    borderTop: `1px solid oklch(0.66 0.10 ${hue})`,
  }
}

function isSameCalendarDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

const DEFAULT_BACKEND_CALENDAR_ID = "calendar-main"
const fallbackColors: CalendarEvent["color"][] = ["mint", "blue", "yellow", "orange", "purple", "cyan"]

function getFallbackColor(calendarId: string | null) {
  const key = calendarId || "default"
  let hash = 0

  for (const char of key) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }

  return fallbackColors[hash % fallbackColors.length]
}

function mapScheduleEventsToCalendarEvents(
  scheduleEvents: ScheduleEvent[],
  displayDates: Date[],
): CalendarEvent[] {
  return scheduleEvents.flatMap((event) => {
    const start = new Date(event.start)
    const end = new Date(event.end)
    const day = displayDates.findIndex((date) => isSameCalendarDay(date, start))

    if (day === -1) {
      return []
    }

    return [
      {
        id: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
        source: event.lastSyncedFrom === "gcal" || Boolean(event.gcalEventId) ? ("google" as const) : ("local" as const),
        isReadOnly: event.isImmutable,
        calendarId: event.calendarId || DEFAULT_BACKEND_CALENDAR_ID,
        allDay: event.allDay,
        location: event.location || undefined,
        color: getFallbackColor(event.calendarId),
        day,
        startHour: start.getHours() + start.getMinutes() / 60,
        duration: Math.max((end.getTime() - start.getTime()) / 3_600_000, 0.25),
      },
    ]
  })
}

function mapTaskReminderEvents(
  tasks: Task[],
  scheduleEvents: ScheduleEvent[],
  displayDates: Date[],
): CalendarEvent[] {
  const scheduledTaskIds = new Set(
    scheduleEvents
      .map((event) => event.taskId)
      .filter((taskId): taskId is string => typeof taskId === "string" && taskId.length > 0),
  )

  return tasks.flatMap((task) => {
    if (
      !task.deadline ||
      scheduledTaskIds.has(task.id) ||
      task.status === "completed" ||
      task.status === "missed"
    ) {
      return []
    }

    const deadline = new Date(task.deadline)
    const day = displayDates.findIndex((date) => isSameCalendarDay(date, deadline))

    if (day === -1) {
      return []
    }

    return [
      {
        id: `task-reminder-${task.id}`,
        title: task.title,
        start: deadline.toISOString(),
        end: deadline.toISOString(),
        source: "task" as const,
        isReadOnly: task.isImmutable,
        calendarId: task.calendarId || TASKS_CALENDAR_ID,
        allDay: true,
        location: undefined,
        color: "purple",
        day,
        startHour: 0,
        duration: 0.25,
        renderVariant: "task-due",
        detail: buildTaskReminderDescription(task),
        dueTimeLabel: getTaskDueTimeLabel(task),
      },
    ]
  })
}

function mapTasksToCalendarEvents(
  tasks: Task[],
  scheduleEvents: ScheduleEvent[],
  displayDates: Date[],
): CalendarEvent[] {
  const scheduledTaskIds = new Set(
    scheduleEvents
      .map((event) => event.taskId)
      .filter((taskId): taskId is string => typeof taskId === "string" && taskId.length > 0),
  )

  return tasks.flatMap((task) => {
    if (
      scheduledTaskIds.has(task.id) ||
      !task.scheduledFor ||
      task.status === "completed" ||
      task.status === "missed"
    ) {
      return []
    }

    const durationHours = Math.max((task.durationMinutes ?? 60) / 60, 0.25)
    const anchorStart = new Date(task.scheduledFor)
    const day = displayDates.findIndex((date) => isSameCalendarDay(date, anchorStart))

    if (day === -1) {
      return []
    }

    const startHour = anchorStart.getHours() + anchorStart.getMinutes() / 60
    const end = new Date(anchorStart.getTime() + durationHours * 3_600_000).toISOString()

    return [
      {
        id: `task-${task.id}`,
        title: task.title,
        start: anchorStart.toISOString(),
        end,
        source: "task" as const,
        isReadOnly: task.isImmutable,
        calendarId: task.calendarId || "cal-tasks",
        allDay: false,
        location: undefined,
        color: getFallbackColor(task.calendarId || "cal-tasks"),
        day,
        startHour,
        duration: durationHours,
      },
    ]
  })
}

interface ScheduleViewProps {
  visibleCalendarIds?: string[]
  calendars?: Calendar[]
  events?: ScheduleEvent[]
  tasks?: Task[]
  onToggleTaskComplete?: (task: Task) => void | Promise<void>
  plannerStatus?: string
  plannerSummary?: string
  onSchedule?: () => void | Promise<void>
  isScheduling?: boolean
}

const HOUR_PX = 48
const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: "1day", label: "1D" },
  { value: "3days", label: "3D" },
  { value: "7days", label: "7D" },
  { value: "1month", label: "MO" },
]
const dayNamesShort = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

function formatHour(hour24: number) {
  return String(hour24).padStart(2, "0")
}

export function ScheduleView({
  visibleCalendarIds,
  calendars,
  events: scheduleEvents = [],
  tasks = [],
  onToggleTaskComplete,
  plannerStatus = "Idle",
  plannerSummary = "",
  onSchedule,
  isScheduling = false,
}: ScheduleViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("7days")
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date())
  const [monthViewDate, setMonthViewDate] = useState<Date>(() => {
    const today = new Date()
    return new Date(today.getFullYear(), today.getMonth(), 1)
  })
  const [isGoogleEventsLoading, setIsGoogleEventsLoading] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle")
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [selectedTaskReminder, setSelectedTaskReminder] = useState<CalendarEvent | null>(null)
  const [now, setNow] = useState(() => new Date())
  const gridScrollRef = useRef<HTMLDivElement | null>(null)
  const hasAutoScrolledRef = useRef(false)
  const successResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (successResetTimeoutRef.current) {
        clearTimeout(successResetTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  const syncGoogleEvents = useCallback(async () => {
    if (successResetTimeoutRef.current) {
      clearTimeout(successResetTimeoutRef.current)
      successResetTimeoutRef.current = null
    }

    setSyncStatus("syncing")
    setIsGoogleEventsLoading(true)

    let didTimeout = false
    const timeoutId = window.setTimeout(() => {
      didTimeout = true
      setSyncStatus("error")
    }, 60_000)

    try {
      await fetchGoogleEvents()

      if (didTimeout) {
        return
      }

      setLastSyncedAt(new Date().toISOString())
      window.dispatchEvent(new CustomEvent("jarvis-dashboard-refresh"))
      setSyncStatus("success")
      successResetTimeoutRef.current = setTimeout(() => {
        setSyncStatus("idle")
      }, 3_000)
    } catch (error) {
      if (!didTimeout) {
        console.error("Failed to fetch Google Events", error)
        setSyncStatus("error")
      }
    } finally {
      clearTimeout(timeoutId)
      setIsGoogleEventsLoading(false)
    }
  }, [])

  const handleSyncWithGoogle = async () => {
    if (syncStatus === "syncing" || isGoogleEventsLoading) {
      return
    }
    await syncGoogleEvents()
  }

  const formatLastSynced = () => {
    if (!lastSyncedAt) {
      return isGoogleEventsLoading ? "syncing" : "never"
    }
    return new Date(lastSyncedAt).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })
  }

  const handleGoToToday = () => {
    const today = new Date()
    setSelectedDate(today)
    setMonthViewDate(new Date(today.getFullYear(), today.getMonth(), 1))
  }

  const handlePrevPeriod = () => {
    if (viewMode === "1month") {
      setMonthViewDate(new Date(monthViewDate.getFullYear(), monthViewDate.getMonth() - 1, 1))
    } else {
      const newDate = new Date(selectedDate)
      newDate.setDate(newDate.getDate() - 1)
      setSelectedDate(newDate)
    }
  }

  const handleNextPeriod = () => {
    if (viewMode === "1month") {
      setMonthViewDate(new Date(monthViewDate.getFullYear(), monthViewDate.getMonth() + 1, 1))
    } else {
      const newDate = new Date(selectedDate)
      newDate.setDate(newDate.getDate() + 1)
      setSelectedDate(newDate)
    }
  }

  const getDaysInMonth = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  const getFirstDayOfMonth = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), 1).getDay()
  const handleDateClick = (day: number) => {
    const newDate = new Date(monthViewDate.getFullYear(), monthViewDate.getMonth(), day)
    setSelectedDate(newDate)
    setViewMode("1day")
  }

  const isToday = (date: Date) => isSameCalendarDay(date, now)

  const displayDates = useMemo(() => {
    const startDate = new Date(selectedDate)
    const count = viewMode === "1day" ? 1 : viewMode === "3days" ? 3 : 7

    return Array.from({ length: count }, (_, index) => {
      const date = new Date(startDate)
      date.setDate(startDate.getDate() + index)
      return date
    })
  }, [selectedDate, viewMode])

  const events = useMemo(() => {
    const mappedEvents = [
      ...mapScheduleEventsToCalendarEvents(scheduleEvents, displayDates),
      ...mapTaskReminderEvents(tasks, scheduleEvents, displayDates),
      ...mapTasksToCalendarEvents(tasks, scheduleEvents, displayDates),
    ]
    const knownCalendarIds = new Set((calendars || []).map((calendar) => calendar.id))

    return visibleCalendarIds
      ? mappedEvents.filter((event) => {
          if (visibleCalendarIds.includes(event.calendarId)) {
            return true
          }
          return event.source === "google" && !knownCalendarIds.has(event.calendarId)
        })
      : mappedEvents
  }, [calendars, displayDates, scheduleEvents, tasks, visibleCalendarIds])

  const allDayEvents = useMemo(() => events.filter((event) => event.allDay), [events])
  const taskReminderEvents = useMemo(
    () => allDayEvents.filter((event) => event.renderVariant === "task-due"),
    [allDayEvents],
  )
  const regularAllDayEvents = useMemo(
    () => allDayEvents.filter((event) => event.renderVariant !== "task-due"),
    [allDayEvents],
  )
  const timedEvents = useMemo(() => events.filter((event) => !event.allDay), [events])
  const hasVisibleEvents = events.length > 0

  useEffect(() => {
    hasAutoScrolledRef.current = false
  }, [selectedDate, viewMode])

  useEffect(() => {
    if (viewMode === "1month" || !gridScrollRef.current || hasAutoScrolledRef.current) {
      return
    }

    if (isGoogleEventsLoading && timedEvents.length === 0) {
      return
    }

    const isCurrentWeekVisible = displayDates.some((date) => isSameCalendarDay(date, now))
    const earliestTimedHour =
      timedEvents.length > 0
        ? Math.max(Math.floor(Math.min(...timedEvents.map((event) => event.startHour))) - 1, 0)
        : null
    const targetHour = isCurrentWeekVisible
      ? Math.max(now.getHours() - 1, 0)
      : earliestTimedHour ?? 7

    gridScrollRef.current.scrollTo({
      top: targetHour * HOUR_PX,
      behavior: "auto",
    })
    hasAutoScrolledRef.current = true
  }, [displayDates, isGoogleEventsLoading, now, timedEvents, viewMode])

  const formatDateRange = () => {
    const start = new Date(selectedDate)
    if (viewMode === "1day") {
      return `${monthNames[start.getMonth()]} ${start.getDate()}`
    }
    if (viewMode === "3days") {
      const end = new Date(start)
      end.setDate(start.getDate() + 2)
      return `${monthNames[start.getMonth()]} ${start.getDate()}–${end.getDate()}`
    }
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    if (start.getMonth() === end.getMonth()) {
      return `${monthNames[start.getMonth()]} ${start.getDate()}–${end.getDate()}`
    }
    return `${monthNames[start.getMonth()]} ${start.getDate()} – ${monthNames[end.getMonth()]} ${end.getDate()}`
  }

  const getEventStyle = (event: CalendarEvent) => {
    const top = event.startHour * HOUR_PX
    const height = event.duration * HOUR_PX
    return {
      top: `${top}px`,
      height: `${Math.max(height, 20)}px`,
    }
  }

  const getEventColorStyle = (event: CalendarEvent) => {
    const calendar = calendars?.find((cal) => cal.id === event.calendarId)
    if (calendar) {
      const hex = calendar.color
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      const brightness = (r * 299 + g * 587 + b * 114) / 1000
      const textColor = brightness > 128 ? "oklch(0.18 0.01 60)" : "oklch(0.96 0.01 80)"
      return {
        backgroundColor: `${hex}45`,
        color: textColor,
        borderTop: `1px solid ${hex}`,
      }
    }
    return fallbackEventStyle(event.color)
  }

  const renderMonthView = () => {
    const daysInMonth = getDaysInMonth(monthViewDate)
    const firstDay = getFirstDayOfMonth(monthViewDate)
    const cells: React.ReactNode[] = []

    for (let i = 0; i < firstDay; i++) {
      cells.push(<div key={`empty-${i}`} className="h-12" />)
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const cellDate = new Date(monthViewDate.getFullYear(), monthViewDate.getMonth(), day)
      const todayCell = isSameCalendarDay(cellDate, now)
      const selected = isSameCalendarDay(cellDate, selectedDate)

      cells.push(
        <button
          key={day}
          onClick={() => handleDateClick(day)}
          className={`num flex h-12 items-start justify-end rounded-sm p-1.5 text-[13px] tabular-nums transition-colors ${
            todayCell
              ? "bg-copper-soft text-foreground ring-1 ring-copper"
              : selected
                ? "bg-accent text-foreground"
                : "text-foreground hover:bg-accent"
          }`}
        >
          {day}
        </button>,
      )
    }

    return cells
  }

  const dayColumnTemplate =
    viewMode === "1day"
      ? "grid-cols-[56px_1fr]"
      : viewMode === "3days"
        ? "grid-cols-[56px_repeat(3,1fr)]"
        : "grid-cols-[56px_repeat(7,1fr)]"

  const showNowLine =
    viewMode !== "1month" && displayDates.some((date) => isSameCalendarDay(date, now))
  const nowTopPx = (now.getHours() + now.getMinutes() / 60) * HOUR_PX
  const nowDayIndex = displayDates.findIndex((date) => isSameCalendarDay(date, now))

  return (
    <section className="flex h-full flex-col">
      <Dialog open={selectedTaskReminder !== null} onOpenChange={(open) => !open && setSelectedTaskReminder(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold tracking-tight">
              {selectedTaskReminder?.title ?? "Task"}
            </DialogTitle>
            <DialogDescription className="num text-[12px]">
              Due {selectedTaskReminder?.dueTimeLabel ?? "—"}
            </DialogDescription>
          </DialogHeader>
          <div className="border-t border-rule pt-3 text-[13px] leading-[1.55] text-foreground">
            {selectedTaskReminder?.detail ?? "No additional detail."}
          </div>
        </DialogContent>
      </Dialog>

      {syncStatus === "success" ? (
        <div className="num fixed right-6 top-20 z-[200] flex items-center gap-2 rounded-sm border border-rule-strong bg-popover px-2.5 py-1.5 text-[11px] uppercase tracking-[0.14em] text-foreground shadow-lg">
          <span className="h-1.5 w-1.5 rounded-full bg-copper" aria-hidden="true" />
          Synced
        </div>
      ) : null}
      {syncStatus === "error" ? (
        <div className="num fixed right-6 top-20 z-[200] flex max-w-xs items-center gap-2.5 rounded-sm border border-destructive/50 bg-popover px-2.5 py-1.5 text-[11px] tracking-[0.04em] text-destructive shadow-lg">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
          <span className="leading-tight">Sync failed. Check Google Calendar.</span>
          <button
            type="button"
            onClick={() => setSyncStatus("idle")}
            aria-label="Dismiss"
            className="ml-1 shrink-0 text-destructive/70 hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <header className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
        <h1 className="text-[28px] font-semibold leading-none tracking-tight text-foreground">
          {viewMode === "1month"
            ? `${monthNames[monthViewDate.getMonth()]} ${monthViewDate.getFullYear()}`
            : formatDateRange()}
        </h1>
        <span className="num inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              plannerStatus === "Ready"
                ? "bg-copper"
                : plannerStatus === "Scheduling"
                  ? "bg-copper/60 animate-pulse"
                  : plannerStatus === "Error"
                    ? "bg-destructive"
                    : "bg-muted-foreground/50"
            }`}
            aria-hidden="true"
          />
          {plannerStatus}
        </span>
        {plannerSummary ? (
          <span
            className={`text-[12px] leading-tight ${
              plannerStatus === "Error" ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {plannerSummary}
          </span>
        ) : null}
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2 border-y border-rule-strong py-2.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onSchedule?.()}
              disabled={isScheduling || !onSchedule}
              aria-label="Run scheduler"
              className="flex h-8 items-center gap-1.5 rounded-sm bg-copper px-3 text-[12px] font-medium uppercase tracking-[0.12em] text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isScheduling ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              ) : (
                <CalendarPlus className="h-4 w-4" strokeWidth={2} />
              )}
              <span className="num">Plan</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-[11px]">
            Schedule open tasks
          </TooltipContent>
        </Tooltip>

        <TaskQueuePopover tasks={tasks} onToggleComplete={onToggleTaskComplete} />

        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleSyncWithGoogle}
                disabled={syncStatus === "syncing" || isGoogleEventsLoading}
                aria-label="Sync Google"
                className="flex h-8 items-center gap-1.5 rounded-sm border border-rule px-2.5 text-[12px] text-foreground hover:bg-accent hover:border-rule-strong disabled:opacity-50"
              >
                {syncStatus === "syncing" || isGoogleEventsLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                <span className="num text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                  {formatLastSynced()}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px]">
              Sync Google
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handlePrevPeriod}
                aria-label="Previous"
                className="flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={1.75} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px]">Previous</TooltipContent>
          </Tooltip>
          <button
            type="button"
            onClick={handleGoToToday}
            className="num flex h-8 items-center rounded-sm px-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Today
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleNextPeriod}
                aria-label="Next"
                className="flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ChevronRight className="h-[18px] w-[18px]" strokeWidth={1.75} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px]">Next</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-center gap-0.5 border-l border-rule pl-2">
          {VIEW_MODES.map((mode) => {
            const active = viewMode === mode.value
            return (
              <button
                key={mode.value}
                type="button"
                onClick={() => setViewMode(mode.value)}
                aria-pressed={active}
                className={`num flex h-8 items-center rounded-sm px-2.5 text-[11px] font-medium uppercase tracking-[0.14em] transition-colors ${
                  active ? "bg-copper-soft text-copper" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {mode.label}
              </button>
            )
          })}
        </div>
      </div>

      {viewMode === "1month" ? (
        <div className="flex flex-1 flex-col">
          <div className="mb-2 grid grid-cols-7 gap-1">
            {dayNamesShort.map((day) => (
              <div key={day} className="num text-center text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {day}
              </div>
            ))}
          </div>
          <div className="grid flex-1 grid-cols-7 gap-1">{renderMonthView()}</div>
        </div>
      ) : (
        <div ref={gridScrollRef} className="relative flex-1 overflow-auto">
          {isGoogleEventsLoading && !hasVisibleEvents ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm">
              <div className="num flex items-center gap-2 rounded-sm border border-rule bg-popover px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading
              </div>
            </div>
          ) : null}

          {/* Day headers */}
          <div
            className={`sticky top-0 z-10 grid bg-background ${dayColumnTemplate} border-b border-rule-strong`}
          >
            <div className="h-14" />
            {displayDates.map((date, i) => (
              <div
                key={i}
                className="flex h-14 flex-col items-start justify-center gap-1 border-l border-rule px-2.5"
              >
                <span className="num text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {dayNamesShort[date.getDay()]}
                </span>
                <span
                  className={`num text-[22px] font-semibold leading-none tabular-nums ${
                    isToday(date) ? "copper" : "text-foreground"
                  }`}
                >
                  {date.getDate()}
                </span>
              </div>
            ))}
          </div>

          {/* All-day lane */}
          <div
            className={`sticky top-14 z-[9] grid bg-background ${dayColumnTemplate} border-b border-rule`}
          >
            <div className="num flex min-h-9 items-start justify-end px-2 py-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              All
            </div>
            {displayDates.map((_, dayIndex) => {
              const dayReminderEvents = taskReminderEvents.filter((event) => event.day === dayIndex)
              const dayAllDayEvents = regularAllDayEvents.filter((event) => event.day === dayIndex)

              return (
                <div
                  key={`all-day-${dayIndex}`}
                  className="min-h-9 border-l border-rule px-1 py-1"
                >
                  <div className="space-y-0.5">
                    {dayReminderEvents.map((event) => (
                      <button
                        type="button"
                        key={event.id}
                        onClick={() => setSelectedTaskReminder(event)}
                        className="num flex w-full items-center gap-1 rounded-sm bg-copper-soft px-1.5 py-0.5 text-left text-[10px] uppercase tracking-[0.1em] text-foreground hover:bg-copper-soft hover:brightness-110"
                      >
                        <span className="copper">●</span>
                        <span className="truncate">{event.title}</span>
                      </button>
                    ))}
                    {dayAllDayEvents.map((event) => (
                      <div
                        key={event.id}
                        className="overflow-hidden rounded-sm px-1.5 py-0.5 text-[10px] font-medium leading-tight"
                        style={getEventColorStyle(event)}
                      >
                        <p className="truncate">{event.title}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Time grid */}
          <div className={`grid ${dayColumnTemplate}`} style={{ minHeight: `${24 * HOUR_PX}px` }}>
            {/* Time gutter */}
            <div className="relative">
              {Array.from({ length: 24 }).map((_, i) => (
                <div
                  key={i}
                  className="num h-[48px] pr-2.5 pt-1 text-right text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground tabular-nums"
                >
                  {i === 0 ? "" : formatHour(i)}
                </div>
              ))}
            </div>

            {/* Day columns */}
            {Array.from({ length: viewMode === "1day" ? 1 : viewMode === "3days" ? 3 : 7 }).map(
              (_, dayIndex) => (
                <div
                  key={dayIndex}
                  className="relative border-l border-rule"
                  style={{ height: `${24 * HOUR_PX}px` }}
                >
                  {/* Hour ticks */}
                  {Array.from({ length: 24 }).map((_, i) => (
                    <div
                      key={i}
                      className="absolute left-0 right-0 border-t border-rule/70"
                      style={{ top: `${i * HOUR_PX}px` }}
                    />
                  ))}
                  {/* Half-hour ticks */}
                  {Array.from({ length: 24 }).map((_, i) => (
                    <div
                      key={`half-${i}`}
                      className="pointer-events-none absolute left-0 w-2 border-t border-rule/40"
                      style={{ top: `${i * HOUR_PX + HOUR_PX / 2}px` }}
                    />
                  ))}

                  {/* Now line */}
                  {showNowLine && nowDayIndex === dayIndex ? (
                    <>
                      <div
                        className="pointer-events-none absolute left-0 right-0 z-[5] h-px bg-copper"
                        style={{ top: `${nowTopPx}px` }}
                      />
                      <div
                        className="pointer-events-none absolute z-[5] h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-copper"
                        style={{ top: `${nowTopPx}px`, left: 0 }}
                      />
                    </>
                  ) : null}

                  {/* Events */}
                  {timedEvents
                    .filter((event) => event.day === dayIndex)
                    .map((event) => (
                      <div
                        key={event.id}
                        className="absolute left-px right-px overflow-hidden px-1.5 py-1"
                        style={{
                          ...getEventStyle(event),
                          ...(calendars ? getEventColorStyle(event) : fallbackEventStyle(event.color)),
                          opacity: event.isReadOnly ? 0.85 : 1,
                        }}
                      >
                        <p className="truncate text-[11px] font-medium leading-tight">{event.title}</p>
                        {event.location && event.duration >= 0.75 ? (
                          <div className="mt-0.5 flex items-center gap-0.5 text-[10px] opacity-80">
                            <MapPin className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate">{event.location}</span>
                          </div>
                        ) : null}
                      </div>
                    ))}
                </div>
              ),
            )}
          </div>
          {!isGoogleEventsLoading && !hasVisibleEvents ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="num text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                No events
              </p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
