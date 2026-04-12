"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { MapPin, ChevronLeft, ChevronRight, RefreshCw, Loader2 } from "lucide-react"
import {
  PLACEHOLDER_MONTH_START_LOCAL,
  PLACEHOLDER_SELECTED_DATE_LOCAL,
} from "@/lib/mock-calendar-events"
import type { ScheduleEvent } from "@/types"
import type { Calendar } from "./calendars-sidebar"

type ViewMode = "1day" | "3days" | "7days" | "1month"

// Enhanced Event interface for Google Calendar integration
export interface CalendarEvent {
  id: string
  title: string
  start: string // ISO Date string
  end: string // ISO Date string
  source: "google" | "local"
  isReadOnly: boolean
  calendarId: string // Links to Calendar.id
  location?: string
  color: "mint" | "blue" | "yellow" | "orange" | "purple" | "cyan"
  // Derived fields for rendering (calculated from start/end)
  day: number
  startHour: number
  duration: number
}

// API Hook: Replace mockSyncStatus with fetch call here
const mockSyncStatus = {
  lastSynced: "Just now",
  isSyncing: false,
}

const colorClasses: Record<CalendarEvent["color"], string> = {
  mint: "bg-[#4ade80] text-[#052e16]",
  blue: "bg-[#3b82f6] text-white",
  yellow: "bg-[#fde047] text-[#422006]",
  orange: "bg-[#fb923c] text-[#431407]",
  purple: "bg-[#c084fc] text-[#3b0764]",
  cyan: "bg-[#22d3ee] text-[#083344]",
}

// Full 24-hour time scale (00:00 - 23:00)
const timeSlots = [
  "12AM", "1AM", "2AM", "3AM", "4AM", "5AM", "6AM", "7AM", "8AM", "9AM", "10AM", "11AM",
  "12PM", "1PM", "2PM", "3PM", "4PM", "5PM", "6PM", "7PM", "8PM", "9PM", "10PM", "11PM"
]

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
) {
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
        source: "local" as const,
        isReadOnly: event.isImmutable,
        calendarId: event.calendarId || DEFAULT_BACKEND_CALENDAR_ID,
        location: event.location || undefined,
        color: getFallbackColor(event.calendarId),
        day,
        startHour: start.getHours() + start.getMinutes() / 60,
        duration: Math.max((end.getTime() - start.getTime()) / 3_600_000, 0.25),
      },
    ]
  })
}

interface ScheduleViewProps {
  onSyncWithGoogle?: () => void
  visibleCalendarIds?: string[]
  calendars?: Calendar[]
  events?: ScheduleEvent[]
  plannerStatus?: string
  plannerSummary?: string
  onSchedule?: () => void | Promise<void>
  isScheduling?: boolean
}

export function ScheduleView({
  onSyncWithGoogle,
  visibleCalendarIds,
  calendars,
  events: scheduleEvents = [],
  plannerStatus = "Not scheduled",
  plannerSummary = "",
  onSchedule,
  isScheduling = false,
}: ScheduleViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("7days")
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date(PLACEHOLDER_SELECTED_DATE_LOCAL))
  const [monthViewDate, setMonthViewDate] = useState<Date>(() => new Date(PLACEHOLDER_MONTH_START_LOCAL))
  const [isSyncing, setIsSyncing] = useState(false)

  const syncStatus = mockSyncStatus

  const handleSyncWithGoogle = async () => {
    setIsSyncing(true)
    // API Hook: Call actual sync function here
    // Example: await syncGoogleCalendar()
    if (onSyncWithGoogle) onSyncWithGoogle()
    setTimeout(() => setIsSyncing(false), 1500) // Simulated sync
  }

  const handleGoToToday = () => {
    const today = new Date()
    setSelectedDate(today)
    setMonthViewDate(new Date(today.getFullYear(), today.getMonth(), 1))
  }

  const getEventStyle = (event: CalendarEvent) => {
    const pixelsPerHour = 48
    const top = event.startHour * pixelsPerHour
    const height = event.duration * pixelsPerHour
    return {
      top: `${top}px`,
      height: `${Math.max(height, 20)}px`,
    }
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
      const textColor = brightness > 128 ? "#1a1a1a" : "#ffffff"
      return {
        backgroundColor: calendar.color,
        color: textColor,
      }
    }
    return {}
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
    const mappedEvents = mapScheduleEventsToCalendarEvents(scheduleEvents, displayDates)

    return visibleCalendarIds
      ? mappedEvents.filter((event) => visibleCalendarIds.includes(event.calendarId))
      : mappedEvents
  }, [displayDates, scheduleEvents, visibleCalendarIds])

  // Get day names for the current view
  const getDayHeaders = () => {
    const days = []
    const startDate = new Date(selectedDate)

    const count = viewMode === "1day" ? 1 : viewMode === "3days" ? 3 : 7
    const today = new Date()
    for (let i = 0; i < count; i++) {
      const date = new Date(startDate)
      date.setDate(startDate.getDate() + i)
      const isTodayDate = date.getDate() === today.getDate() && 
                          date.getMonth() === today.getMonth() && 
                          date.getFullYear() === today.getFullYear()
      days.push({
        name: dayNames[date.getDay()],
        date: date.getDate(),
        isToday: isTodayDate,
      })
    }
    return days
  }

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
            ${isTodayDate ? "bg-[#3b82f6] text-white ring-2 ring-[#3b82f6] ring-offset-2 ring-offset-background" : ""}
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
    <Card className="bg-card border-border h-full flex flex-col">
      <CardHeader className="p-3 pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base font-bold text-foreground">Schedule</CardTitle>
            <CardDescription className="text-xs text-muted-foreground font-semibold">
              {viewMode === "1month" 
                ? `${monthNames[monthViewDate.getMonth()]} ${monthViewDate.getFullYear()}`
                : formatDateRange()}
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            {/* Sync Status */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-semibold">
                Last synced: {syncStatus.lastSynced}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSyncWithGoogle}
                disabled={isSyncing}
                className="text-xs h-7 px-2 font-semibold"
              >
                {isSyncing ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3 mr-1" />
                )}
                Sync with Google
              </Button>
            </div>
            <span className="text-xs text-muted-foreground font-semibold">Planner: {plannerStatus}</span>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground leading-tight font-medium">
          Schedule runs only when you click Schedule/Replan. Dragging a block pins it by default.
        </p>
        {plannerSummary ? (
          <p className={`text-[11px] leading-tight font-medium mt-1 ${
            plannerStatus === "Error" ? "text-red-400" : "text-muted-foreground"
          }`}>
            {plannerSummary}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="p-3 pt-0 flex-1 flex flex-col overflow-hidden">
        {/* Controls - hidden on mobile, shown on tablet+ */}
        <div className="hidden md:flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex gap-1 flex-wrap">
            <Button
              size="sm"
              onClick={() => onSchedule?.()}
              disabled={isScheduling || !onSchedule}
              className="bg-[#3b82f6] hover:bg-[#2563eb] text-white text-xs h-7 px-3 font-semibold disabled:opacity-70"
            >
              {isScheduling ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : null}
              Schedule
            </Button>
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
            <div className="flex gap-0.5 bg-secondary/50 rounded-lg p-0.5">
              {(["1day", "3days", "7days", "1month"] as ViewMode[]).map((mode) => (
                <Button
                  key={mode}
                  variant={viewMode === mode ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode(mode)}
                  className={
                    viewMode === mode
                      ? "bg-[#3b82f6] text-white text-xs h-7 px-3 font-semibold"
                      : "text-muted-foreground hover:text-foreground text-xs h-7 px-3 font-semibold"
                  }
                >
                  {mode === "1day" ? "1 Day" : mode === "3days" ? "3 Days" : mode === "7days" ? "7 Days" : "1 Month"}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Mobile Controls */}
        <div className="flex md:hidden items-center justify-between mb-2 gap-2">
          <Button
            size="sm"
            onClick={() => onSchedule?.()}
            disabled={isScheduling || !onSchedule}
            className="bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[10px] h-6 px-2 font-semibold disabled:opacity-70"
          >
            {isScheduling ? (
              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            ) : null}
            Schedule
          </Button>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-muted-foreground font-semibold">Days:</span>
            <div className="flex gap-0.5 bg-secondary/50 rounded-lg p-0.5">
            {(["1day", "3days", "7days", "1month"] as ViewMode[]).map((mode) => (
              <Button
                key={mode}
                variant={viewMode === mode ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode(mode)}
                className={
                  viewMode === mode
                    ? "bg-[#3b82f6] text-white text-[10px] h-6 px-2 font-semibold"
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
          <div className="flex-1 flex flex-col">
            {/* Month navigation */}
            <div className="flex items-center justify-center gap-2 mb-4">
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
            
            {/* Day headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {dayNames.map((day) => (
                <div key={day} className="text-center text-xs text-muted-foreground font-semibold">
                  {day}
                </div>
              ))}
            </div>
            
            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1 flex-1">
              {renderMonthView()}
            </div>
            
            <p className="text-xs text-muted-foreground text-center mt-3 font-medium">
              Click a date to view that day
            </p>
          </div>
        ) : (
          /* Calendar Grid - Day Views (1, 3, 7 days) */
          <div className="flex-1 overflow-auto relative">
            {/* Day Headers */}
            <div 
              className={`grid gap-px sticky top-0 z-10 bg-card dark:bg-[#141414] ${
                viewMode === "1day" 
                  ? "grid-cols-[60px_1fr]" 
                  : viewMode === "3days" 
                  ? "grid-cols-[60px_repeat(3,1fr)]" 
                  : "grid-cols-[60px_repeat(7,1fr)]"
              }`}
            >
              <div className="h-12" /> {/* Empty corner cell */}
              {displayDates.map((date, i) => (
                <div 
                  key={i} 
                  className="h-12 flex flex-col items-center justify-center border-l border-border dark:border-[#2a2a2a] bg-card dark:bg-[#1a1a1a]"
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
            
            {/* Time Grid */}
            <div 
              className={`grid gap-px ${
                viewMode === "1day" 
                  ? "grid-cols-[60px_1fr]" 
                  : viewMode === "3days" 
                  ? "grid-cols-[60px_repeat(3,1fr)]" 
                  : "grid-cols-[60px_repeat(7,1fr)]"
              }`}
              style={{ minHeight: `${24 * 48}px` }}
            >
              {/* Time column */}
              <div className="flex flex-col">
                {timeSlots.map((time, i) => (
                  <div 
                    key={i} 
                    className="h-[48px] text-xs font-semibold text-muted-foreground pr-2 text-right flex items-start pt-0.5"
                  >
                    {time}
                  </div>
                ))}
              </div>

              {/* Day columns */}
              {Array.from({ length: viewMode === "1day" ? 1 : viewMode === "3days" ? 3 : 7 }).map((_, dayIndex) => (
                <div
                  key={dayIndex}
                  className="relative bg-secondary/30 border-l border-border flex-1"
                  style={{ height: `${24 * 48}px` }}
                >
                  {/* Hour lines */}
                  {timeSlots.map((_, i) => (
                    <div
                      key={i}
                      className="absolute w-full border-t border-border/50"
                      style={{ top: `${i * 48}px` }}
                    />
                  ))}

                  {/* Events */}
                  {events
                    .filter((event) => event.day === dayIndex)
                    .map((event) => (
                      <div
                        key={event.id}
                        className={`absolute left-0.5 right-0.5 rounded px-1 py-0.5 overflow-hidden ${
                          calendars ? "" : colorClasses[event.color]
                        } ${event.isReadOnly ? "opacity-90" : ""}`}
                        style={{
                          ...getEventStyle(event),
                          ...(calendars ? getEventColorStyle(event) : {}),
                        }}
                      >
                        <p className="text-[9px] font-semibold truncate leading-tight pr-3">{event.title}</p>
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
          </div>
        )}
      </CardContent>
    </Card>
  )
}
