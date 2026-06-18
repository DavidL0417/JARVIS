"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  CalendarDays,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Loader2,
  MapPin,
  RefreshCw,
  X,
} from "lucide-react"
import {
  fetchCalDavEvents,
  fetchGoogleEvents,
  isGoogleCalendarAuthorizationError,
  startGoogleSourceAuthorizationRedirect,
} from "@/lib/supabase/auth-actions"
import {
  buildTaskReminderDescription,
  getTaskDueTimeLabel,
  TASKS_CALENDAR_ID,
} from "@/lib/task-calendar-constants"
import { normalizeHexColor } from "@/lib/color"
import { buildTimedEventLayoutMap, type TimedEventLayout } from "@/lib/schedule-layout"
import type { Priority, ScheduleEvent, ScheduleEventUpdateRequest, ScheduleEventUpdateResponse, Task } from "@/types"
import type { Calendar } from "./calendars-sidebar"
import { TaskQueuePopover } from "./task-queue-popover"

type ViewMode = "1day" | "3days" | "7days" | "1month"
type SyncStatus = "idle" | "syncing" | "success" | "error"

export interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  source: "google" | "caldav" | "local" | "task"
  isReadOnly: boolean
  calendarId: string
  allDay: boolean
  location?: string
  color: "mint" | "blue" | "yellow" | "orange" | "purple" | "cyan"
  priority: Priority
  day: number
  daySpanEnd?: number
  startHour: number
  duration: number
  canEdit: boolean
  renderVariant?: "default" | "task-due"
  detail?: string
  dueTimeLabel?: string
  // An imported event JARVIS added that the operator hasn't confirmed yet.
  // Rendered with a copper dashed outline + a confirm checkmark; still a concrete
  // commitment for planning. (schedule_events.source === "imported" && !isCheckedIn)
  isProvisional?: boolean
}

const fallbackHues: Record<CalendarEvent["color"], number> = {
  mint: 165,
  blue: 240,
  yellow: 95,
  orange: 50,
  purple: 290,
  cyan: 200,
}

// Tiles are SOLID blends of the calendar color into the page background: a
// translucent fill over near-black washed every hue toward gray, so the body never
// matched the full-opacity accent bar — and opaque tiles are required for the
// Apple-style cascade overlap to read correctly.
function fallbackEventStyle(color: CalendarEvent["color"]) {
  const hue = fallbackHues[color]
  return {
    backgroundColor: `oklch(0.31 0.045 ${hue})`,
    color: `oklch(0.88 0.06 ${hue})`,
    borderLeft: `3px solid oklch(0.66 0.10 ${hue})`,
    boxShadow: "0 0 0 1px var(--background)",
  }
}

function formatTileTimeRange(startIso: string, endIso: string) {
  const format = (iso: string) => {
    const date = new Date(iso)
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
  }
  return `${format(startIso)} – ${format(endIso)}`
}

function isSameCalendarDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function getDayIndicesInRange(
  start: Date,
  end: Date,
  displayDates: Date[],
): number[] {
  if (displayDates.length === 0) return []
  const startMs = start.getTime()
  const endMs = end.getTime()
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    const single = displayDates.findIndex((date) => isSameCalendarDay(date, start))
    return single === -1 ? [] : [single]
  }
  const indices: number[] = []
  displayDates.forEach((date, idx) => {
    const dayStart = new Date(date)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(date)
    dayEnd.setHours(23, 59, 59, 999)
    if (dayEnd.getTime() >= startMs && dayStart.getTime() <= endMs) {
      indices.push(idx)
    }
  })
  return indices
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
    const source =
      event.lastSyncedFrom === "caldav"
        ? ("caldav" as const)
        : event.lastSyncedFrom === "gcal" || Boolean(event.gcalEventId)
          ? ("google" as const)
          : ("local" as const)
    const base = {
      title: event.title,
      start: event.start,
      end: event.end,
      source,
      isReadOnly: event.isImmutable,
      calendarId: event.calendarId || DEFAULT_BACKEND_CALENDAR_ID,
      allDay: event.allDay,
      location: event.location || undefined,
      color: getFallbackColor(event.calendarId),
      priority: event.priority,
      startHour: start.getHours() + start.getMinutes() / 60,
      duration: Math.max((end.getTime() - start.getTime()) / 3_600_000, 0.25),
      canEdit: true,
      isProvisional: event.source === "imported" && !event.isCheckedIn,
    }

    if (event.allDay) {
      const days = getDayIndicesInRange(start, end, displayDates)
      if (days.length === 0) return []
      return [
        {
          ...base,
          id: event.id,
          day: days[0],
          daySpanEnd: days[days.length - 1],
        },
      ]
    }

    const day = displayDates.findIndex((date) => isSameCalendarDay(date, start))
    if (day === -1) return []
    return [
      {
        ...base,
        id: event.id,
        day,
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
        priority: task.priority,
        day,
        startHour: 0,
        duration: 0.25,
        canEdit: false,
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
    const endDate = new Date(anchorStart.getTime() + durationHours * 3_600_000)
    const startHour = anchorStart.getHours() + anchorStart.getMinutes() / 60
    const base = {
      title: task.title,
      start: anchorStart.toISOString(),
      end: endDate.toISOString(),
      source: "task" as const,
      isReadOnly: task.isImmutable,
      calendarId: task.calendarId || "cal-tasks",
      allDay: task.allDay,
      location: undefined,
      color: getFallbackColor(task.calendarId || "cal-tasks"),
      priority: task.priority,
      startHour,
      duration: durationHours,
      canEdit: false,
    }

    if (task.allDay) {
      const days = getDayIndicesInRange(anchorStart, endDate, displayDates)
      if (days.length === 0) return []
      return [
        {
          ...base,
          id: `task-${task.id}`,
          day: days[0],
          daySpanEnd: days[days.length - 1],
        },
      ]
    }

    const day = displayDates.findIndex((date) => isSameCalendarDay(date, anchorStart))
    if (day === -1) return []
    return [
      {
        ...base,
        id: `task-${task.id}`,
        day,
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
  onOpenCalendars?: () => void
  isScheduling?: boolean
}

const HOUR_PX = 48
// Apple-style floor: events shorter than ~27 min all render at this single
// height instead of shrinking with duration. It's sized to fit exactly one
// line of title (14px) plus the tile's py-1 padding (8px), so a one-line tile
// is vertically centered rather than clipped.
const MIN_EVENT_PX = 22
const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: "1day", label: "1D" },
  { value: "3days", label: "3D" },
  { value: "7days", label: "7D" },
  { value: "1month", label: "MO" },
]
const PRIORITY_OPTIONS: Array<{ value: Priority; label: string }> = [
  { value: "high", label: "High priority" },
  { value: "medium", label: "Medium priority" },
  { value: "low", label: "Low priority" },
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

function getApiErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const details = "details" in payload && typeof payload.details === "string" ? payload.details : null
    const error = "error" in payload && typeof payload.error === "string" ? payload.error : null
    return details || error || fallback
  }

  return fallback
}

function assignAllDayLanes(events: CalendarEvent[]): Map<string, number> {
  const sorted = [...events].sort((a, b) => {
    if (a.day !== b.day) return a.day - b.day
    const aEnd = a.daySpanEnd ?? a.day
    const bEnd = b.daySpanEnd ?? b.day
    if (aEnd !== bEnd) return bEnd - aEnd
    return a.title.localeCompare(b.title)
  })
  const lanesEnd: number[] = []
  const result = new Map<string, number>()
  for (const event of sorted) {
    const start = event.day
    const end = event.daySpanEnd ?? event.day
    let lane = lanesEnd.findIndex((prevEnd) => prevEnd < start)
    if (lane === -1) {
      lane = lanesEnd.length
      lanesEnd.push(end)
    } else {
      lanesEnd[lane] = end
    }
    result.set(event.id, lane)
  }
  return result
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
  onOpenCalendars,
  isScheduling = false,
}: ScheduleViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("7days")
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date())
  const [monthViewDate, setMonthViewDate] = useState<Date>(() => {
    const today = new Date()
    return new Date(today.getFullYear(), today.getMonth(), 1)
  })
  const [isGoogleEventsLoading, setIsGoogleEventsLoading] = useState(false)
  const [isAuthorizingGoogle, setIsAuthorizingGoogle] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle")
  const [syncErrorMessage, setSyncErrorMessage] = useState<string | null>(null)
  const [syncNeedsAuthorization, setSyncNeedsAuthorization] = useState(false)
  const [eventEditError, setEventEditError] = useState<string | null>(null)
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

  const syncCalendars = useCallback(async () => {
    if (successResetTimeoutRef.current) {
      clearTimeout(successResetTimeoutRef.current)
      successResetTimeoutRef.current = null
    }

    setSyncStatus("syncing")
    setSyncErrorMessage(null)
    setSyncNeedsAuthorization(false)
    setIsGoogleEventsLoading(true)

    let didTimeout = false
    const timeoutId = window.setTimeout(() => {
      didTimeout = true
      setSyncStatus("error")
    }, 60_000)

    try {
      // Refresh every connected calendar source. Google drives the authorization flow;
      // CalDAV (Apple) is best-effort so it refreshes alongside without its own button —
      // previously it only updated via the daily cron and could silently go stale.
      const [googleResult, calDavResult] = await Promise.allSettled([
        fetchGoogleEvents(),
        fetchCalDavEvents(),
      ])

      if (didTimeout) {
        return
      }

      if (googleResult.status === "rejected") {
        throw googleResult.reason
      }

      if (calDavResult.status === "rejected") {
        console.warn("CalDAV sync failed", calDavResult.reason)
      }

      setLastSyncedAt(new Date().toISOString())
      window.dispatchEvent(new CustomEvent("jarvis-dashboard-refresh"))
      setSyncStatus("success")
      setSyncErrorMessage(null)
      setSyncNeedsAuthorization(false)
      successResetTimeoutRef.current = setTimeout(() => {
        setSyncStatus("idle")
      }, 3_000)
    } catch (error) {
      if (!didTimeout) {
        console.error("Failed to fetch Google Events", error)
        const needsAuthorization = isGoogleCalendarAuthorizationError(error)
        setSyncErrorMessage(
          needsAuthorization
            ? "Google Calendar needs authorization."
            : error instanceof Error
              ? error.message
              : "Google Calendar sync failed.",
        )
        setSyncNeedsAuthorization(needsAuthorization)
        setSyncStatus("error")
      }
    } finally {
      clearTimeout(timeoutId)
      setIsGoogleEventsLoading(false)
    }
  }, [])

  const handleAuthorizeGoogle = useCallback(async () => {
    if (isAuthorizingGoogle) {
      return
    }

    setIsAuthorizingGoogle(true)

    try {
      await startGoogleSourceAuthorizationRedirect()
    } catch (error) {
      console.error("Failed to start Google authorization", error)
      setSyncErrorMessage(
        error instanceof Error ? error.message : "Could not start Google authorization.",
      )
      setSyncNeedsAuthorization(true)
      setSyncStatus("error")
      setIsAuthorizingGoogle(false)
    }
  }, [isAuthorizingGoogle])

  const handleSyncWithGoogle = async () => {
    if (syncStatus === "syncing" || isGoogleEventsLoading || isAuthorizingGoogle) {
      return
    }
    if (syncNeedsAuthorization) {
      await handleAuthorizeGoogle()
      return
    }
    await syncCalendars()
  }

  const updateEventSettings = useCallback(async (event: CalendarEvent, patch: ScheduleEventUpdateRequest) => {
    if (!event.canEdit) {
      return
    }

    setEventEditError(null)

    const response = await fetch(`/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
      cache: "no-store",
    })
    const payload = (await response.json().catch(() => null)) as ScheduleEventUpdateResponse | { error?: string; details?: string } | null

    if (!response.ok || !payload || !("success" in payload)) {
      throw new Error(getApiErrorMessage(payload, "Failed to update event."))
    }

    window.dispatchEvent(new CustomEvent("jarvis-dashboard-refresh"))
  }, [])

  const handleEventSettingsChange = useCallback(
    async (event: CalendarEvent, patch: ScheduleEventUpdateRequest) => {
      try {
        await updateEventSettings(event, patch)
      } catch (error) {
        setEventEditError(error instanceof Error ? error.message : "Failed to update event.")
      }
    },
    [updateEventSettings],
  )

  const formatLastSynced = () => {
    if (syncNeedsAuthorization) {
      return isAuthorizingGoogle ? "opening" : "authorize"
    }
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
          return (event.source === "google" || event.source === "caldav") && !knownCalendarIds.has(event.calendarId)
        })
      : mappedEvents
  }, [calendars, displayDates, scheduleEvents, tasks, visibleCalendarIds])

  const allDayEvents = useMemo(() => events.filter((event) => event.allDay), [events])
  const visibleCalendarCount = useMemo(
    () => (calendars ?? []).filter((calendar) => calendar.isVisible).length,
    [calendars],
  )
  const taskReminderEvents = useMemo(
    () => allDayEvents.filter((event) => event.renderVariant === "task-due"),
    [allDayEvents],
  )
  const regularAllDayEvents = useMemo(
    () => allDayEvents.filter((event) => event.renderVariant !== "task-due"),
    [allDayEvents],
  )
  const timedEvents = useMemo(() => events.filter((event) => !event.allDay), [events])
  const timedEventLayouts = useMemo(() => buildTimedEventLayoutMap(timedEvents), [timedEvents])
  const allDayLanes = useMemo(
    () => assignAllDayLanes([...taskReminderEvents, ...regularAllDayEvents]),
    [regularAllDayEvents, taskReminderEvents],
  )
  const allDayLaneCount = useMemo(() => {
    let max = 0
    for (const lane of allDayLanes.values()) {
      if (lane + 1 > max) max = lane + 1
    }
    return max
  }, [allDayLanes])
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

    const scrollContainer = gridScrollRef.current
    const isCurrentWeekVisible = displayDates.some((date) => isSameCalendarDay(date, now))
    const startHours = timedEvents.map((event) => event.startHour)
    // Content-first anchor: land on the earliest timed event in the visible range.
    // The now-line still renders, but it never drives scroll — anchoring to "now"
    // hides the day whenever the current time is far from the events (e.g. opening
    // at 2 AM with a 3 PM exam scrolled the grid to an empty midnight band).
    const earliestTimedHour =
      startHours.length > 0 ? Math.max(Math.floor(Math.min(...startHours)) - 1, 0) : null
    const targetHour =
      earliestTimedHour ?? (isCurrentWeekVisible ? Math.max(now.getHours() - 1, 0) : 7)

    scrollContainer.scrollTo({
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
      height: `${Math.max(height, MIN_EVENT_PX)}px`,
    }
  }

  const getEventColorStyle = (event: CalendarEvent) => {
    const calendar = calendars?.find((cal) => cal.id === event.calendarId)
    const hex = normalizeHexColor(calendar?.color)
    if (hex) {
      // One color story per calendar: the accent bar is the raw calendar color, the
      // body is the same color blended (opaquely) into the page background, and the
      // text is the same color lifted toward white. The background ring separates
      // tiles that cascade on top of each other.
      return {
        backgroundColor: `color-mix(in srgb, ${hex} 26%, var(--background))`,
        color: `color-mix(in srgb, ${hex} 70%, white)`,
        borderLeft: `3px solid ${hex}`,
        boxShadow: "0 0 0 1px var(--background)",
      }
    }
    return fallbackEventStyle(event.color)
  }

  const getAllDayPillStyle = (event: CalendarEvent) => {
    const calendar = calendars?.find((cal) => cal.id === event.calendarId)
    const hex = normalizeHexColor(calendar?.color)
    if (hex) {
      return {
        backgroundColor: `color-mix(in srgb, ${hex} 18%, var(--background))`,
        color: `color-mix(in srgb, ${hex} 62%, white)`,
        borderLeft: `2px solid ${hex}`,
      }
    }
    const fallback = fallbackEventStyle(event.color)
    return {
      backgroundColor: fallback.backgroundColor,
      color: fallback.color,
      borderLeft: fallback.borderLeft.replace("3px", "2px"),
    }
  }

  // Every event gets a right-click menu. Editable events expose controls;
  // read-only ones (planner blocks, due reminders) explain what they are instead.
  const renderEventContextMenu = (event: CalendarEvent, trigger: ReactElement) => {
    const kicker =
      event.renderVariant === "task-due"
        ? "Due reminder"
        : event.source === "task"
          ? "Task block"
          : event.isProvisional
            ? "Imported · confirm"
            : "Calendar event"
    const readOnlyNote =
      event.renderVariant === "task-due"
        ? "Reminder of a task deadline. Manage it from the task queue."
        : event.source === "task"
          ? "Planned block managed by the scheduler. Re-plan to move it."
          : "This event is read-only."

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{trigger}</ContextMenuTrigger>
        <ContextMenuContent className="min-w-48 border-rule-strong bg-popover text-popover-foreground">
          <ContextMenuLabel className="num px-2 py-1 text-[10px] uppercase text-muted-foreground">
            {kicker}
          </ContextMenuLabel>
          <ContextMenuLabel className="truncate px-2 pb-1 pt-0 text-[13px] font-medium text-foreground">
            {event.title}
          </ContextMenuLabel>
          {event.isProvisional ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={() => void handleEventSettingsChange(event, { isCheckedIn: true })}
                className="gap-2 text-[13px] text-copper"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Confirm import
              </ContextMenuItem>
            </>
          ) : null}
          {event.canEdit ? (
            <>
              <ContextMenuSeparator />
              <ContextMenuLabel className="num px-2 py-1 text-[10px] uppercase text-muted-foreground">
                Priority
              </ContextMenuLabel>
              <ContextMenuRadioGroup
                value={event.priority}
                onValueChange={(value) => {
                  if (value !== event.priority) {
                    void handleEventSettingsChange(event, { priority: value as Priority })
                  }
                }}
              >
                {PRIORITY_OPTIONS.map((priority) => (
                  <ContextMenuRadioItem key={priority.value} value={priority.value} className="text-[13px]">
                    {priority.label}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
              <ContextMenuSeparator />
              <ContextMenuCheckboxItem
                checked={event.isReadOnly}
                onCheckedChange={(checked) => {
                  void handleEventSettingsChange(event, { isImmutable: checked === true })
                }}
                className="text-[13px]"
              >
                Fixed in place
              </ContextMenuCheckboxItem>
            </>
          ) : (
            <>
              <ContextMenuSeparator />
              <ContextMenuLabel className="max-w-56 whitespace-normal px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
                {readOnlyNote}
              </ContextMenuLabel>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    )
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
  const nowTimeLabel = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
  // Width of the time gutter (the fixed first grid column). The now-line spans the
  // day columns starting just past it, and today's dot is offset across them.
  const GUTTER_PX = 56

  return (
    <section className="flex h-full flex-col">
      <Dialog open={selectedTaskReminder !== null} onOpenChange={(open) => !open && setSelectedTaskReminder(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">
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
        <div className="num fixed right-6 top-20 z-[200] flex items-center gap-2 rounded-sm border border-rule-strong bg-popover px-2.5 py-1.5 text-[11px] uppercase text-foreground shadow-lg">
          <span className="h-1.5 w-1.5 rounded-full bg-copper" aria-hidden="true" />
          Synced
        </div>
      ) : null}
      {syncStatus === "error" ? (
        <div className="num fixed right-6 top-20 z-[200] flex max-w-sm items-center gap-2.5 rounded-sm border border-destructive/50 bg-popover px-2.5 py-1.5 text-[11px] text-destructive shadow-lg">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
          <span className="leading-tight">
            {syncErrorMessage ?? "Google Calendar sync failed."}
          </span>
          {syncNeedsAuthorization ? (
            <button
              type="button"
              onClick={handleAuthorizeGoogle}
              disabled={isAuthorizingGoogle}
              className="shrink-0 rounded-sm border border-destructive/40 px-2 py-1 text-[10px] uppercase text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              {isAuthorizingGoogle ? "Opening" : "Authorize"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setSyncStatus("idle")
              setSyncErrorMessage(null)
              setSyncNeedsAuthorization(false)
            }}
            aria-label="Dismiss"
            className="ml-1 shrink-0 text-destructive/70 hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
      {eventEditError ? (
        <div className="num fixed right-6 top-32 z-[200] flex max-w-sm items-center gap-2.5 rounded-sm border border-destructive/50 bg-popover px-2.5 py-1.5 text-[11px] text-destructive shadow-lg">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
          <span className="leading-tight">{eventEditError}</span>
          <button
            type="button"
            onClick={() => setEventEditError(null)}
            aria-label="Dismiss event update error"
            className="ml-1 shrink-0 text-destructive/70 hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <header className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
        <h1 className="text-[28px] font-semibold leading-none text-foreground">
          {viewMode === "1month"
            ? `${monthNames[monthViewDate.getMonth()]} ${monthViewDate.getFullYear()}`
            : formatDateRange()}
        </h1>
        <span className="num inline-flex items-center gap-1.5 text-[11px] font-medium uppercase text-muted-foreground">
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
              className="flex h-8 items-center gap-1.5 rounded-sm bg-copper px-3 text-[12px] font-medium uppercase text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
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
                disabled={syncStatus === "syncing" || isGoogleEventsLoading || isAuthorizingGoogle}
                aria-label={syncNeedsAuthorization ? "Authorize Google Calendar" : "Sync calendars"}
                className="flex h-8 items-center gap-1.5 rounded-sm border border-rule px-2.5 text-[12px] text-foreground hover:bg-accent hover:border-rule-strong disabled:opacity-50"
              >
                {syncStatus === "syncing" || isGoogleEventsLoading || isAuthorizingGoogle ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : syncNeedsAuthorization ? (
                  <KeyRound className="h-3.5 w-3.5" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                <span className="num text-[10.5px] uppercase text-muted-foreground">
                  {formatLastSynced()}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-[11px]">
              {syncNeedsAuthorization ? "Authorize Google Calendar" : "Sync calendars"}
            </TooltipContent>
          </Tooltip>
          {onOpenCalendars ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onOpenCalendars}
                  aria-label="Choose visible calendars"
                  className="flex h-8 items-center gap-1.5 rounded-sm border border-rule px-2.5 text-[12px] text-foreground hover:border-rule-strong hover:bg-accent"
                >
                  <CalendarDays className="h-3.5 w-3.5 text-copper" />
                  <span className="num text-[10.5px] uppercase text-muted-foreground">
                    Calendars
                  </span>
                  <span className="num text-[10.5px] uppercase text-foreground">
                    {visibleCalendarCount}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[11px]">
                Choose visible calendars
              </TooltipContent>
            </Tooltip>
          ) : null}
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
            className="num flex h-8 items-center rounded-sm px-2.5 text-[11px] font-medium uppercase text-muted-foreground hover:bg-accent hover:text-foreground"
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
                className={`num flex h-8 items-center rounded-sm px-2.5 text-[11px] font-medium uppercase transition-colors ${
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
              <div key={day} className="num text-center text-[10px] uppercase text-muted-foreground">
                {day}
              </div>
            ))}
          </div>
          <div className="grid flex-1 grid-cols-7 gap-1">{renderMonthView()}</div>
        </div>
      ) : (
        <div ref={gridScrollRef} className="relative flex-1 overflow-auto">
          {/* Day headers */}
          <div
            className={`sticky top-0 z-[40] grid bg-background ${dayColumnTemplate} border-b border-rule-strong`}
          >
            <div className="h-14" />
            {displayDates.map((date, i) => (
              <div
                key={i}
                className="flex h-14 flex-col items-start justify-center gap-1 border-l border-rule px-2.5"
              >
                <span className="num text-[11px] font-medium uppercase text-muted-foreground">
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
            className={`sticky top-14 z-[35] grid bg-background ${dayColumnTemplate} border-b border-rule`}
          >
            <div className="num flex min-h-9 items-start justify-end px-2 py-1.5 text-[11px] font-medium uppercase text-muted-foreground">
              All
            </div>
            <div
              className="relative col-span-full"
              style={{ gridColumnStart: 2, gridColumnEnd: displayDates.length + 2 }}
            >
              <div
                className="absolute inset-0 grid"
                style={{ gridTemplateColumns: `repeat(${displayDates.length}, minmax(0, 1fr))` }}
              >
                {displayDates.map((_, i) => (
                  <div key={`all-day-bg-${i}`} className="border-l border-rule" />
                ))}
              </div>
              <div
                className="relative grid px-0 py-1"
                style={{
                  gridTemplateColumns: `repeat(${displayDates.length}, minmax(0, 1fr))`,
                  gridAutoRows: "20px",
                  rowGap: 2,
                  minHeight: `${Math.max(allDayLaneCount, 1) * 22 + 8}px`,
                }}
              >
                {taskReminderEvents.map((event) => {
                  const lane = allDayLanes.get(event.id) ?? 0
                  return (
                    <Fragment key={event.id}>
                      {renderEventContextMenu(
                        event,
                        <button
                          type="button"
                          onClick={() => setSelectedTaskReminder(event)}
                          style={{
                            gridColumnStart: event.day + 1,
                            gridColumnEnd: (event.daySpanEnd ?? event.day) + 2,
                            gridRowStart: lane + 1,
                          }}
                          className="num mx-1 flex items-center gap-1 overflow-hidden rounded-sm bg-copper-soft px-1.5 py-0.5 text-left text-[10px] uppercase text-foreground hover:bg-copper-soft hover:brightness-110"
                        >
                          <span className="copper shrink-0">●</span>
                          <span className="truncate">{event.title}</span>
                        </button>,
                      )}
                    </Fragment>
                  )
                })}
                {regularAllDayEvents.map((event) => {
                  const lane = allDayLanes.get(event.id) ?? 0
                  return (
                    <Fragment key={event.id}>
                      {renderEventContextMenu(
                        event,
                        <div
                          style={{
                            gridColumnStart: event.day + 1,
                            gridColumnEnd: (event.daySpanEnd ?? event.day) + 2,
                            gridRowStart: lane + 1,
                            fontWeight: "calc(var(--app-weight) + 100)",
                            ...getAllDayPillStyle(event),
                            ...(event.isProvisional
                              ? { outline: "1.5px dashed var(--copper)", outlineOffset: "-1.5px" }
                              : {}),
                          }}
                          className="mx-1 overflow-hidden rounded-sm px-1.5 py-0.5 text-[10px] leading-tight"
                        >
                          <p className="truncate">{event.title}</p>
                        </div>,
                      )}
                    </Fragment>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Time grid */}
          <div className={`relative grid ${dayColumnTemplate}`} style={{ minHeight: `${24 * HOUR_PX}px` }}>
            {/* Time gutter */}
            <div className="relative">
              {Array.from({ length: 24 }).map((_, i) => (
                <div
                  key={i}
                  className="num h-[48px] pr-2.5 pt-1 text-right text-[11px] font-medium uppercase text-muted-foreground tabular-nums"
                >
                  {i === 0 ? "" : formatHour(i)}
                </div>
              ))}
              {/* Current-time badge, aligned to the now-line in the gutter */}
              {showNowLine ? (
                <div
                  className="num pointer-events-none absolute right-1 z-[31] -translate-y-1/2 rounded-sm bg-copper px-1 py-px text-[9px] font-medium tabular-nums text-primary-foreground"
                  style={{ top: `${nowTopPx}px` }}
                >
                  {nowTimeLabel}
                </div>
              ) : null}
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

                  {/* Events */}
                  {timedEvents
                    .filter((event) => event.day === dayIndex)
                    .map((event) => {
                      const layout: TimedEventLayout = timedEventLayouts.get(event.id) ?? {
                        leftPct: 0,
                        widthPct: 100,
                        zIndex: 10,
                      }
                      // Content priority is title > location > time: the title may
                      // wrap but is never dropped; location and time appear only
                      // when the tile has lines to spare. A tile covered by a
                      // cascading neighbor only counts its UNCOVERED strip —
                      // otherwise its location/time lines poke out from beneath.
                      const tileHeightPx = Math.max(event.duration * HOUR_PX, MIN_EVENT_PX)
                      const visibleHeightPx =
                        layout.visibleMinutes !== undefined
                          ? Math.min(tileHeightPx, (layout.visibleMinutes / 60) * HOUR_PX)
                          : tileHeightPx
                      const lineBudget = Math.max(Math.floor((visibleHeightPx - 8) / 14), 1)
                      // The title's wrap takes priority over metadata (Apple
                      // progression): short tiles show only the title — wrapped to
                      // two lines if room — and location/time appear only once the
                      // tile has spare lines beyond that.
                      const showLocation = Boolean(event.location) && lineBudget >= 3
                      const showTime = lineBudget >= (showLocation ? 4 : 3)
                      const titleLines = Math.min(
                        Math.max(lineBudget - (showLocation ? 1 : 0) - (showTime ? 1 : 0), 1),
                        3,
                      )

                      return (
                        <Fragment key={event.id}>
                          {renderEventContextMenu(
                            event,
                            <div
                              className="absolute overflow-hidden rounded-[3px] px-1.5 py-1"
                              style={{
                                ...getEventStyle(event),
                                left: `calc(${layout.leftPct}% + 1px)`,
                                width: `calc(${layout.widthPct}% - 2px)`,
                                zIndex: layout.zIndex,
                                ...(calendars ? getEventColorStyle(event) : fallbackEventStyle(event.color)),
                                ...(event.isProvisional
                                  ? { outline: "1.5px dashed var(--copper)", outlineOffset: "-1.5px" }
                                  : {}),
                              }}
                            >
                              {event.isProvisional ? (
                                <button
                                  type="button"
                                  onClick={(clickEvent) => {
                                    clickEvent.stopPropagation()
                                    void handleEventSettingsChange(event, { isCheckedIn: true })
                                  }}
                                  aria-label={`Confirm ${event.title}`}
                                  className="absolute right-0.5 top-0.5 z-[1] flex h-4 w-4 items-center justify-center rounded-sm bg-copper text-primary-foreground hover:brightness-110"
                                >
                                  <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden="true" />
                                </button>
                              ) : null}
                              <p
                                className="text-[12px] leading-[14px]"
                                style={{
                                  // Calendar entries read one weight step above
                                  // the rest of the UI so they pop like Apple's.
                                  fontWeight: "calc(var(--app-weight) + 100)",
                                  display: "-webkit-box",
                                  WebkitBoxOrient: "vertical",
                                  WebkitLineClamp: titleLines,
                                  overflow: "hidden",
                                }}
                              >
                                {event.title}
                              </p>
                              {showLocation ? (
                                <div className="flex items-center gap-0.5 text-[10px] leading-[14px] opacity-80">
                                  <MapPin className="h-2.5 w-2.5 shrink-0" />
                                  <span className="truncate">{event.location}</span>
                                </div>
                              ) : null}
                              {showTime ? (
                                <p className="text-[10px] leading-[14px] opacity-70">
                                  {formatTileTimeRange(event.start, event.end)}
                                </p>
                              ) : null}
                            </div>,
                          )}
                        </Fragment>
                      )
                    })}
                </div>
              ),
            )}

            {/* Now indicator — a single overlay spanning the whole grid so it sits
                above every event tile (z-30, below the sticky z-35/z-40 headers).
                A faint hairline stretches across all day columns; a thicker solid
                segment + dot mark today's column. Only shown when today is in range.
                All three center on nowTopPx so they stack cleanly. */}
            {showNowLine ? (
              <>
                <div
                  className="pointer-events-none absolute right-0 z-[30] h-px -translate-y-1/2 bg-copper/40"
                  style={{ top: `${nowTopPx}px`, left: `${GUTTER_PX}px` }}
                />
                <div
                  className="pointer-events-none absolute z-[30] h-0.5 -translate-y-1/2 rounded-full bg-copper"
                  style={{
                    top: `${nowTopPx}px`,
                    left: `calc(${GUTTER_PX}px + ${nowDayIndex} * (100% - ${GUTTER_PX}px) / ${displayDates.length})`,
                    width: `calc((100% - ${GUTTER_PX}px) / ${displayDates.length})`,
                  }}
                />
                <div
                  className="pointer-events-none absolute z-[30] h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-copper"
                  style={{
                    top: `${nowTopPx}px`,
                    left: `calc(${GUTTER_PX}px + ${nowDayIndex} * (100% - ${GUTTER_PX}px) / ${displayDates.length})`,
                  }}
                />
              </>
            ) : null}
          </div>
          {!isGoogleEventsLoading && !hasVisibleEvents ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="num text-[11px] uppercase text-muted-foreground">
                No events
              </p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
