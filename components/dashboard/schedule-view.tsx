"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { MapPin, ChevronLeft, ChevronRight, RefreshCw, Loader2, X } from "lucide-react"
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

// Enhanced Event interface for Google Calendar integration
export interface CalendarEvent {
  id: string
  title: string
  start: string // ISO Date string
  end: string // ISO Date string
  source: "google" | "local" | "task"
  isReadOnly: boolean
  calendarId: string // Links to Calendar.id
  allDay: boolean
  location?: string
  color: "mint" | "blue" | "yellow" | "orange" | "purple" | "cyan"
  // Derived fields for rendering (calculated from start/end)
  day: number
  startHour: number
  duration: number
  renderVariant?: "default" | "task-due"
  detail?: string
  dueTimeLabel?: string
}

const HOUR_HEIGHT = 56

const fallbackColors: CalendarEvent["color"][] = ["mint", "blue", "yellow", "orange", "purple", "cyan"]
const DEFAULT_BACKEND_CALENDAR_ID = "calendar-main"

function getFallbackColor(calendarId: string | null) {
  const key = calendarId || "default"
  let hash = 0

  for (const char of key) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }

  return fallbackColors[hash % fallbackColors.length]
}

function getFallbackEventColorStyle(color: CalendarEvent["color"]) {
  switch (color) {
    case "mint":
      return { backgroundColor: "oklch(0.7 0.12 154)", color: "oklch(0.16 0.018 292)" }
    case "blue":
      return { backgroundColor: "oklch(0.68 0.095 220)", color: "oklch(0.16 0.018 292)" }
    case "yellow":
      return { backgroundColor: "oklch(0.74 0.115 76)", color: "oklch(0.18 0.018 292)" }
    case "orange":
      return { backgroundColor: "oklch(0.72 0.12 38)", color: "oklch(0.18 0.018 292)" }
    case "purple":
      return { backgroundColor: "oklch(0.66 0.105 320)", color: "oklch(0.96 0.01 88)" }
    case "cyan":
      return { backgroundColor: "oklch(0.72 0.09 195)", color: "oklch(0.16 0.018 292)" }
  }
}

function formatHourLabel(hour: number) {
  if (hour === 0) {
    return "12AM"
  }

  if (hour === 12) {
    return "12PM"
  }

  return hour > 12 ? `${hour - 12}PM` : `${hour}AM`
}

function isSameCalendarDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
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
        source: event.lastSyncedFrom === "gcal" || Boolean(event.gcalEventId) ? "google" as const : "local" as const,
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

export function ScheduleView({
  visibleCalendarIds,
  calendars,
  events: scheduleEvents = [],
  tasks = [],
  onToggleTaskComplete,
  plannerStatus = "Not scheduled",
  plannerSummary = "",
  onSchedule,
  isScheduling = false,
}: ScheduleViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
      return "1day"
    }

    return "3days"
  })
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date())
  const [monthViewDate, setMonthViewDate] = useState<Date>(() => {
    const today = new Date()
    return new Date(today.getFullYear(), today.getMonth(), 1)
  })
  const [isGoogleEventsLoading, setIsGoogleEventsLoading] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle")
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [selectedTaskReminder, setSelectedTaskReminder] = useState<CalendarEvent | null>(null)
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
      return isGoogleEventsLoading ? "Syncing..." : "Not yet"
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

  // Get event background color from calendar
  const getEventColorStyle = (event: CalendarEvent) => {
    const calendar = calendars?.find(cal => cal.id === event.calendarId)
    if (calendar) {
      // Convert hex to rgba for background with good text contrast
      const hex = calendar.color
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      const brightness = (r * 299 + g * 587 + b * 114) / 1000
      const textColor = brightness > 128 ? "oklch(0.18 0.018 292)" : "oklch(0.96 0.01 88)"
      return {
        backgroundColor: calendar.color,
        color: textColor,
      }
    }
    return getFallbackEventColorStyle(event.color)
  }

  // Navigation helpers
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

  const navigatePrevious = () => {
    handlePrevPeriod()
  }



  // Month view helpers
  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  }

  const getFirstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay()
  }

  const handleDateClick = (day: number) => {
    const newDate = new Date(monthViewDate.getFullYear(), monthViewDate.getMonth(), day)
    setSelectedDate(newDate)
    setViewMode("1day")
  }

  const handlePrevMonth = () => {
    setMonthViewDate(new Date(monthViewDate.getFullYear(), monthViewDate.getMonth() - 1, 1))
  }

  const handleNextMonth = () => {
    setMonthViewDate(new Date(monthViewDate.getFullYear(), monthViewDate.getMonth() + 1, 1))
  }

  const monthNames = ["January", "February", "March", "April", "May", "June", 
                      "July", "August", "September", "October", "November", "December"]
  
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

  const isToday = (date: Date) => {
    const today = new Date()
    return date.getDate() === today.getDate() && 
           date.getMonth() === today.getMonth() && 
           date.getFullYear() === today.getFullYear()
  }

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
  const allDayEvents = useMemo(
    () => events.filter((event) => event.allDay),
    [events],
  )
  const taskReminderEvents = useMemo(
    () => allDayEvents.filter((event) => event.renderVariant === "task-due"),
    [allDayEvents],
  )
  const regularAllDayEvents = useMemo(
    () => allDayEvents.filter((event) => event.renderVariant !== "task-due"),
    [allDayEvents],
  )
  const timedEvents = useMemo(
    () => events.filter((event) => !event.allDay),
    [events],
  )
  const hasVisibleEvents = events.length > 0

  const timelineBounds = useMemo(() => {
    if (viewMode === "1month") {
      return { startHour: 0, endHour: 24 }
    }

    const now = new Date()
    const isCurrentPeriodVisible = displayDates.some((date) => isSameCalendarDay(date, now))
    const eventStarts = timedEvents.map((event) => event.startHour)
    const eventEnds = timedEvents.map((event) => event.startHour + event.duration)
    const earliest = eventStarts.length > 0 ? Math.floor(Math.min(...eventStarts)) - 1 : 7
    const latest = eventEnds.length > 0 ? Math.ceil(Math.max(...eventEnds)) + 1 : 22
    const currentHour = now.getHours()
    const shouldAnchorToNow = isCurrentPeriodVisible && currentHour >= 7 && currentHour <= 22
    const currentStart = shouldAnchorToNow ? currentHour - 1 : 7
    const currentEnd = shouldAnchorToNow ? currentHour + 3 : 22
    let startHour = Math.max(0, Math.min(7, earliest, currentStart))
    let endHour = Math.min(24, Math.max(22, latest, currentEnd))

    if (endHour - startHour < 8) {
      endHour = Math.min(24, startHour + 8)
      startHour = Math.max(0, endHour - 8)
    }

    return { startHour, endHour }
  }, [displayDates, timedEvents, viewMode])

  const visibleTimeSlots = useMemo(() => {
    return Array.from(
      { length: timelineBounds.endHour - timelineBounds.startHour },
      (_, index) => timelineBounds.startHour + index,
    )
  }, [timelineBounds])

  const getEventStyle = (event: CalendarEvent) => {
    const top = (event.startHour - timelineBounds.startHour) * HOUR_HEIGHT
    const height = event.duration * HOUR_HEIGHT

    return {
      top: `${Math.max(top, 0)}px`,
      height: `${Math.max(height, 22)}px`,
    }
  }

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

    const now = new Date()
    const isCurrentWeekVisible = displayDates.some((date) => isSameCalendarDay(date, now))
    const earliestTimedHour =
      timedEvents.length > 0
        ? Math.max(Math.floor(Math.min(...timedEvents.map((event) => event.startHour))) - 1, 0)
        : null
    const currentHour = now.getHours()
    const shouldAnchorToNow = isCurrentWeekVisible && currentHour >= 7 && currentHour <= 22
    const targetHour = shouldAnchorToNow
      ? Math.max(now.getHours() - 1, 0)
      : earliestTimedHour ?? 7

    gridScrollRef.current.scrollTo({
      top: Math.max(targetHour - timelineBounds.startHour, 0) * HOUR_HEIGHT,
      behavior: "auto",
    })
    hasAutoScrolledRef.current = true
  }, [displayDates, isGoogleEventsLoading, timedEvents, timelineBounds, viewMode])

  const formatDateRange = () => {
    const start = new Date(selectedDate)
    if (viewMode === "1day") {
      return `${monthNames[start.getMonth()]} ${start.getDate()}, ${start.getFullYear()}`
    }

    if (viewMode === "3days") {
      const end = new Date(start)
      end.setDate(start.getDate() + 2)
      return `${monthNames[start.getMonth()]} ${start.getDate()} - ${end.getDate()}, ${start.getFullYear()}`
    }

    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    return `${monthNames[start.getMonth()]} ${start.getDate()} - ${end.getDate()}, ${start.getFullYear()}`
  }

  const renderMonthView = () => {
    const daysInMonth = getDaysInMonth(monthViewDate)
    const firstDay = getFirstDayOfMonth(monthViewDate)
    const days = []
    
    // Empty cells for days before the first day of the month
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="h-10 md:h-12" />)
    }
    
    // Days of the month
    const today = new Date()
    for (let day = 1; day <= daysInMonth; day++) {
      const isTodayDate = day === today.getDate() && 
                          monthViewDate.getMonth() === today.getMonth() && 
                          monthViewDate.getFullYear() === today.getFullYear()
      const isSelected = selectedDate.getDate() === day && 
                         selectedDate.getMonth() === monthViewDate.getMonth() &&
                         selectedDate.getFullYear() === monthViewDate.getFullYear()
      
      days.push(
        <button
          key={day}
          onClick={() => handleDateClick(day)}
          className={`h-10 md:h-12 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center
            ${isTodayDate ? "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}
            ${isSelected && !isTodayDate ? "bg-secondary text-foreground" : ""}
            ${!isTodayDate && !isSelected ? "hover:bg-secondary text-foreground" : ""}
          `}
        >
          {day}
        </button>
      )
    }
    
    return days
  }

  return (
    <Card className="flex h-full flex-col border-border bg-card">
      <Dialog open={selectedTaskReminder !== null} onOpenChange={(open) => !open && setSelectedTaskReminder(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{selectedTaskReminder?.title ?? "Task Reminder"}</DialogTitle>
            <DialogDescription>
              Due time: {selectedTaskReminder?.dueTimeLabel ?? "No due time set"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-xl border border-border bg-secondary/30 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Reminder Details
              </p>
              <p className="mt-2 font-medium text-foreground">
                {selectedTaskReminder?.detail ?? "No additional detail available."}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {syncStatus === "success" ? (
        <div className="fixed left-1/2 top-4 z-[200] -translate-x-1/2 rounded-md border border-success/40 bg-success px-4 py-2 text-sm font-semibold text-success-foreground shadow-lg">
          Successfully synced
        </div>
      ) : null}
      {syncStatus === "error" ? (
        <div className="fixed left-1/2 bottom-4 z-[200] flex -translate-x-1/2 items-center gap-3 rounded-md border border-destructive/40 bg-destructive px-4 py-3 text-sm font-semibold text-destructive-foreground shadow-xl">
          <span>Sync failed. Check the Google Calendar connection.</span>
          <button
            type="button"
            onClick={() => setSyncStatus("idle")}
            className="rounded-md p-1 transition-colors hover:bg-background/20"
            aria-label="Dismiss sync error"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      <CardHeader className="flex-shrink-0 p-3 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base font-semibold text-foreground">Schedule</CardTitle>
            <CardDescription className="text-xs font-medium text-muted-foreground">
              {viewMode === "1month" 
                ? `${monthNames[monthViewDate.getMonth()]} ${monthViewDate.getFullYear()}`
                : formatDateRange()}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Synced {formatLastSynced()}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncWithGoogle}
                disabled={syncStatus === "syncing" || isGoogleEventsLoading}
                className="text-xs h-7 px-2 font-semibold"
              >
                {syncStatus === "syncing" || isGoogleEventsLoading ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3 mr-1" />
                )}
                Sync
              </Button>
            </div>
            <span className="rounded-md border border-border bg-surface-subtle px-2 py-1 text-xs font-medium text-muted-foreground">
              Planner {plannerStatus}
            </span>
          </div>
        </div>
        {!isGoogleEventsLoading && scheduleEvents.length === 0 && tasks.length === 0 ? (
          <p className="mt-1 text-[11px] font-medium leading-tight text-muted-foreground">
            No calendar or task blocks yet.
          </p>
        ) : null}
        {plannerSummary ? (
          <p className={`mt-1 text-[11px] font-medium leading-tight ${
            plannerStatus === "Error" ? "text-destructive" : "text-muted-foreground"
          }`}>
            {plannerSummary}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col overflow-hidden p-3 pt-0">
        <div className="hidden md:flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex gap-1 flex-wrap">
            <Button
              size="sm"
              onClick={() => onSchedule?.()}
              disabled={isScheduling || !onSchedule}
              className="h-7 px-3 text-xs font-semibold disabled:opacity-70"
            >
              {isScheduling ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : null}
              Schedule
            </Button>
                <TaskQueuePopover tasks={tasks} onToggleComplete={onToggleTaskComplete} />
          </div>

          {/* Center - Navigation */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={navigatePrevious}
              className="h-8 w-8"
            >
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleGoToToday}
              className="text-muted-foreground hover:text-foreground hover:bg-secondary text-xs h-7 px-3 font-semibold"
            >
              Today
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleNextPeriod}
              className="h-8 w-8"
            >
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-semibold">Days:</span>
            <div className="flex gap-0.5 rounded-md bg-secondary/60 p-0.5">
              {(["1day", "3days", "7days", "1month"] as ViewMode[]).map((mode) => (
                <Button
                  key={mode}
                  variant={viewMode === mode ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode(mode)}
                  className={
                    viewMode === mode
                      ? "h-7 px-3 text-xs font-semibold"
                      : "text-muted-foreground hover:text-foreground text-xs h-7 px-3 font-semibold"
                  }
                >
                  {mode === "1day" ? "1 Day" : mode === "3days" ? "3 Days" : mode === "7days" ? "7 Days" : "1 Month"}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex md:hidden items-center justify-between mb-2 gap-2">
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              onClick={() => onSchedule?.()}
              disabled={isScheduling || !onSchedule}
              className="h-7 px-2 text-[10px] font-semibold disabled:opacity-70"
            >
              {isScheduling ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : null}
              Schedule
            </Button>
            <TaskQueuePopover tasks={tasks} onToggleComplete={onToggleTaskComplete} />
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-muted-foreground font-semibold">Days:</span>
            <div className="flex gap-0.5 rounded-md bg-secondary/60 p-0.5">
            {(["1day", "3days", "7days", "1month"] as ViewMode[]).map((mode) => (
              <Button
                key={mode}
                variant={viewMode === mode ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode(mode)}
                className={
                  viewMode === mode
                    ? "h-6 px-2 text-[10px] font-semibold"
                    : "text-muted-foreground hover:text-foreground text-[10px] h-6 px-2 font-semibold"
                }
              >
                {mode === "1day" ? "1D" : mode === "3days" ? "3D" : mode === "7days" ? "7D" : "Mo"}
              </Button>
            ))}
            </div>
          </div>
        </div>

        {/* Month View */}
        {viewMode === "1month" ? (
          <div className="flex flex-1 flex-col">
            <div className="mb-4 flex items-center justify-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={handlePrevMonth}
                className="h-8 w-8"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGoToToday}
                className="text-muted-foreground hover:text-foreground hover:bg-secondary text-xs h-7 px-3 font-semibold"
              >
                Today
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleNextMonth}
                className="h-8 w-8"
              >
                <ChevronRight className="w-5 h-5" />
              </Button>
              <span className="text-base font-bold text-foreground ml-2">
                {monthNames[monthViewDate.getMonth()]} {monthViewDate.getFullYear()}
              </span>
            </div>
            
            <div className="grid grid-cols-7 gap-1 mb-2">
              {dayNames.map((day) => (
                <div key={day} className="text-center text-xs text-muted-foreground font-semibold">
                  {day}
                </div>
              ))}
            </div>
            
            <div className="grid grid-cols-7 gap-1 flex-1">
              {renderMonthView()}
            </div>
            
            <p className="mt-3 text-center text-xs font-medium text-muted-foreground">Choose a date to focus the timeline.</p>
          </div>
        ) : (
          <div ref={gridScrollRef} className="flex-1 overflow-auto relative">
            {isGoogleEventsLoading && !hasVisibleEvents ? (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-card/90">
                <div className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading calendar events...
                </div>
              </div>
            ) : null}
            <div 
              className={`sticky top-0 z-10 grid gap-px bg-card ${
                viewMode === "1day" 
                  ? "grid-cols-[60px_1fr]" 
                  : viewMode === "3days" 
                  ? "grid-cols-[60px_repeat(3,1fr)]" 
                  : "grid-cols-[60px_repeat(7,1fr)]"
              }`}
            >
              <div className="h-12" />
              {displayDates.map((date, i) => (
                <div 
                  key={i} 
                  className="flex h-12 flex-col items-center justify-center border-l border-border bg-card"
                >
                  <span className="text-xs font-semibold text-muted-foreground">
                    {dayNames[date.getDay()]}
                  </span>
                  <span className={`text-base font-bold flex items-center justify-center w-8 h-8 rounded-full ${
                    isToday(date)
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground"
                  }`}>
                    {date.getDate()}
                  </span>
                </div>
              ))}
            </div>

            <div
              className={`sticky top-12 z-[9] grid gap-px bg-card ${
                viewMode === "1day"
                  ? "grid-cols-[60px_1fr]"
                  : viewMode === "3days"
                  ? "grid-cols-[60px_repeat(3,1fr)]"
                  : "grid-cols-[60px_repeat(7,1fr)]"
              }`}
            >
              <div className="min-h-9 px-2 py-2 text-right text-[10px] font-semibold text-muted-foreground">
                All day
              </div>
              {displayDates.map((_, dayIndex) => {
                const dayReminderEvents = taskReminderEvents.filter((event) => event.day === dayIndex)
                const dayAllDayEvents = regularAllDayEvents.filter((event) => event.day === dayIndex)
                const hasAnyAllDayContent = dayReminderEvents.length > 0 || dayAllDayEvents.length > 0

                return (
                  <div
                    key={`all-day-${dayIndex}`}
                    className="min-h-9 border-l border-border bg-card px-1 py-1"
                  >
                    {!hasAnyAllDayContent ? (
                      <div className="h-6 rounded border border-dashed border-border/50" />
                    ) : (
                      <div className="space-y-1">
                        {dayReminderEvents.map((event) => (
                          <button
                            type="button"
                            key={event.id}
                            onClick={() => setSelectedTaskReminder(event)}
                            className="flex w-full items-center justify-between rounded-md border border-warning/35 bg-warning/10 px-2 py-1 text-left text-[10px] font-semibold text-foreground transition-colors hover:bg-warning/15"
                          >
                            <span className="truncate">{event.title}</span>
                            <span className="ml-2 shrink-0 text-[9px] uppercase tracking-wide opacity-70">
                              Due
                            </span>
                          </button>
                        ))}
                        {dayAllDayEvents.map((event) => (
                          <div
                            key={event.id}
                            className={`overflow-hidden rounded px-2 py-1 ${event.isReadOnly ? "opacity-90" : ""}`}
                            style={getEventColorStyle(event)}
                          >
                            <p className="text-[10px] font-semibold truncate leading-tight">
                              {event.title}
                            </p>
                            {event.location ? (
                              <p className="text-[9px] truncate opacity-80 font-medium">
                                {event.location}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            
            <div 
              className={`grid gap-px ${
                viewMode === "1day" 
                  ? "grid-cols-[60px_1fr]" 
                  : viewMode === "3days" 
                  ? "grid-cols-[60px_repeat(3,1fr)]" 
                  : "grid-cols-[60px_repeat(7,1fr)]"
              }`}
              style={{ minHeight: `${visibleTimeSlots.length * HOUR_HEIGHT}px` }}
            >
              <div className="flex flex-col">
                {visibleTimeSlots.map((hour) => (
                  <div 
                    key={hour} 
                    className="flex items-start justify-end pr-2 pt-0.5 text-xs font-semibold text-muted-foreground"
                    style={{ height: `${HOUR_HEIGHT}px` }}
                  >
                    {formatHourLabel(hour)}
                  </div>
                ))}
              </div>

              {Array.from({ length: viewMode === "1day" ? 1 : viewMode === "3days" ? 3 : 7 }).map((_, dayIndex) => (
                <div
                  key={dayIndex}
                  className="relative flex-1 border-l border-border bg-surface-subtle"
                  style={{ height: `${visibleTimeSlots.length * HOUR_HEIGHT}px` }}
                >
                  {visibleTimeSlots.map((_, i) => (
                    <div
                      key={i}
                      className="absolute w-full border-t border-border/50"
                      style={{ top: `${i * HOUR_HEIGHT}px` }}
                    />
                  ))}

                  {timedEvents
                    .filter((event) => event.day === dayIndex)
                    .map((event) => (
                      <div
                        key={event.id}
                        className={`absolute left-1 right-1 overflow-hidden rounded-md px-1.5 py-1 shadow-sm ${event.isReadOnly ? "opacity-90" : ""}`}
                        style={{
                          ...getEventStyle(event),
                          ...getEventColorStyle(event),
                        }}
                      >
                        <p className="truncate pr-3 text-[10px] font-semibold leading-tight">{event.title}</p>
                        {event.location && event.duration >= 0.75 && (
                          <div className="flex items-center gap-0.5">
                            <MapPin className="w-2 h-2 flex-shrink-0" />
                            <p className="text-[8px] truncate opacity-80 font-medium">{event.location}</p>
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              ))}
            </div>
            {!isGoogleEventsLoading && !hasVisibleEvents ? (
              <div className="flex h-full min-h-[320px] items-center justify-center px-4 text-center">
                <p className="text-sm font-medium text-muted-foreground">No events found</p>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
