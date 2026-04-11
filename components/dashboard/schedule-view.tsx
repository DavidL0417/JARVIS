"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { MapPin, ChevronLeft, ChevronRight, RefreshCw, Loader2 } from "lucide-react"
import type { Calendar } from "./calendars-sidebar"

type ViewMode = "1day" | "3days" | "7days" | "1month"
type TabMode = "calendars" | "schedule"

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

// API Hook: Replace with useCalendarEvents hook
// Example: const { data: events, isLoading, mutate } = useCalendarEvents()
// This is the central hook where backend team can replace mock data
const mockEvents: CalendarEvent[] = [
  // Personal Calendar (cal-1)
  { id: "1", calendarId: "cal-1", title: "PAD Meeting", location: "University...", color: "purple", day: 0, startHour: 18, duration: 2.5, start: "2026-04-06T18:00:00", end: "2026-04-06T20:30:00", source: "google", isReadOnly: true },
  { id: "19", calendarId: "cal-1", title: "Dinner w Evan", color: "cyan", day: 3, startHour: 18, duration: 1, start: "2026-04-09T18:00:00", end: "2026-04-09T19:00:00", source: "local", isReadOnly: false },
  { id: "25", calendarId: "cal-1", title: "Hotpot", color: "cyan", day: 4, startHour: 18, duration: 3, start: "2026-04-10T18:00:00", end: "2026-04-10T21:00:00", source: "local", isReadOnly: false },
  
  // Work Calendar (cal-2)
  { id: "22", calendarId: "cal-2", title: "Innovation L...", location: "Microsoft T...", color: "orange", day: 4, startHour: 13, duration: 1, start: "2026-04-10T13:00:00", end: "2026-04-10T14:00:00", source: "local", isReadOnly: false },

  // Northwestern Classes (cal-3)
  { id: "2", calendarId: "cal-3", title: "MATH 240-0", location: "Lunt 105", color: "mint", day: 0, startHour: 10, duration: 1, start: "2026-04-06T10:00:00", end: "2026-04-06T11:00:00", source: "google", isReadOnly: true },
  { id: "3", calendarId: "cal-3", title: "HISTORY 38...", location: "Locy Hall 111", color: "blue", day: 0, startHour: 11, duration: 1, start: "2026-04-06T11:00:00", end: "2026-04-06T12:00:00", source: "google", isReadOnly: true },
  { id: "4", calendarId: "cal-3", title: "PHIL 101-8 O...", location: "Crowe 3-178", color: "cyan", day: 0, startHour: 15, duration: 0.5, start: "2026-04-06T15:00:00", end: "2026-04-06T15:30:00", source: "local", isReadOnly: false },
  { id: "5", calendarId: "cal-3", title: "PHIL 101-8 (seminar)", location: "Shepard Ha...", color: "cyan", day: 0, startHour: 16, duration: 1, start: "2026-04-06T16:00:00", end: "2026-04-06T17:00:00", source: "local", isReadOnly: false },
  { id: "7", calendarId: "cal-3", title: "MATH 240-0...", location: "Lunt Hall 103", color: "mint", day: 1, startHour: 10, duration: 1, start: "2026-04-07T10:00:00", end: "2026-04-07T11:00:00", source: "google", isReadOnly: true },
  { id: "8", calendarId: "cal-3", title: "LEGAL_ST 221-0", location: "Harris Hall...", color: "yellow", day: 1, startHour: 13, duration: 1, start: "2026-04-07T13:00:00", end: "2026-04-07T14:00:00", source: "google", isReadOnly: true },
  { id: "9", calendarId: "cal-3", title: "COMP_SCI 397-0 (semi...", location: "RB135 - Th...", color: "yellow", day: 1, startHour: 14.5, duration: 2.5, start: "2026-04-07T14:30:00", end: "2026-04-07T17:00:00", source: "local", isReadOnly: false },
  { id: "11", calendarId: "cal-3", title: "HISTORY 38...", location: "Locy Hall 111", color: "blue", day: 2, startHour: 11, duration: 1, start: "2026-04-08T11:00:00", end: "2026-04-08T12:00:00", source: "google", isReadOnly: true },
  { id: "12", calendarId: "cal-3", title: "PHIL 101-8 O...", location: "Crowe 3-178", color: "cyan", day: 2, startHour: 15, duration: 0.5, start: "2026-04-08T15:00:00", end: "2026-04-08T15:30:00", source: "local", isReadOnly: false },
  { id: "13", calendarId: "cal-3", title: "PHIL 101-8 (seminar)", location: "Shepard Ha...", color: "cyan", day: 2, startHour: 16, duration: 1, start: "2026-04-08T16:00:00", end: "2026-04-08T17:00:00", source: "local", isReadOnly: false },
  { id: "16", calendarId: "cal-3", title: "LEGAL_ST 221-0", location: "Harris Hall...", color: "yellow", day: 3, startHour: 13, duration: 1, start: "2026-04-09T13:00:00", end: "2026-04-09T14:00:00", source: "google", isReadOnly: true },
  { id: "17", calendarId: "cal-3", title: "LEGAL_ST 2...", location: "Kresge Cen...", color: "yellow", day: 3, startHour: 16, duration: 1, start: "2026-04-09T16:00:00", end: "2026-04-09T17:00:00", source: "local", isReadOnly: false },
  { id: "20", calendarId: "cal-3", title: "MATH 240-0", location: "Lunt 105", color: "mint", day: 4, startHour: 10, duration: 1, start: "2026-04-10T10:00:00", end: "2026-04-10T11:00:00", source: "google", isReadOnly: true },
  { id: "21", calendarId: "cal-3", title: "HISTORY 38...", location: "Locy Hall 111", color: "blue", day: 4, startHour: 11, duration: 1, start: "2026-04-10T11:00:00", end: "2026-04-10T12:00:00", source: "google", isReadOnly: true },
  { id: "23", calendarId: "cal-3", title: "HISTORY 38...", location: "Kresge Cen...", color: "blue", day: 4, startHour: 14, duration: 1, start: "2026-04-10T14:00:00", end: "2026-04-10T15:00:00", source: "google", isReadOnly: true },

  // Project Vela (cal-4)
  { id: "6", calendarId: "cal-4", title: "Project Vela...", color: "orange", day: 0, startHour: 16.5, duration: 0.5, start: "2026-04-06T16:30:00", end: "2026-04-06T17:00:00", source: "local", isReadOnly: false },
  { id: "10", calendarId: "cal-4", title: "Project Vela...", color: "orange", day: 1, startHour: 16.5, duration: 1.5, start: "2026-04-07T16:30:00", end: "2026-04-07T18:00:00", source: "local", isReadOnly: false },
  { id: "14", calendarId: "cal-4", title: "Project Vela...", color: "orange", day: 2, startHour: 16.5, duration: 0.5, start: "2026-04-08T16:30:00", end: "2026-04-08T17:00:00", source: "local", isReadOnly: false },
  { id: "18", calendarId: "cal-4", title: "Project Vela...", color: "orange", day: 3, startHour: 16.5, duration: 0.5, start: "2026-04-09T16:30:00", end: "2026-04-09T17:00:00", source: "local", isReadOnly: false },
  { id: "24", calendarId: "cal-4", title: "Project Vela...", color: "orange", day: 4, startHour: 16.5, duration: 0.5, start: "2026-04-10T16:30:00", end: "2026-04-10T17:00:00", source: "local", isReadOnly: false },

  // Social Calendar (cal-5)
  { id: "15", calendarId: "cal-5", title: "Feiyi Recital", location: "Galvin Reci...", color: "cyan", day: 2, startHour: 18, duration: 1, start: "2026-04-08T18:00:00", end: "2026-04-08T19:00:00", source: "google", isReadOnly: true },
]

// API Hook: Replace mockSyncStatus with fetch call here
const mockSyncStatus = {
  lastSynced: "Just now",
  isSyncing: false,
}

// API Hook: Replace mockScheduleStatus with fetch call here
const mockScheduleStatus = {
  plannerStatus: "Not scheduled",
  currentMonth: "April 2026",
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

// Google "G" icon component for events from Google Calendar
function GoogleIcon() {
  return (
    <svg className="w-2.5 h-2.5 absolute top-0.5 right-0.5" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

interface ScheduleViewProps {
  onSyncWithGoogle?: () => void
  visibleCalendarIds?: string[]
  calendars?: Calendar[]
}

export function ScheduleView({ onSyncWithGoogle, visibleCalendarIds, calendars }: ScheduleViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("7days")
  const [tabMode, setTabMode] = useState<TabMode>("schedule")
  const [selectedDate, setSelectedDate] = useState<Date>(new Date(2026, 3, 11)) // April 11, 2026
  const [monthViewDate, setMonthViewDate] = useState<Date>(new Date(2026, 3, 1)) // April 2026
  const [isSyncing, setIsSyncing] = useState(false)

  // API Hook: Replace with useCalendarEvents()
  const allEvents = mockEvents
  const syncStatus = mockSyncStatus
  const scheduleStatus = mockScheduleStatus

  // Filter events based on visible calendars
  const events = visibleCalendarIds 
    ? allEvents.filter(event => visibleCalendarIds.includes(event.calendarId))
    : allEvents

  // Get calendar color for an event
  const getEventColor = (event: CalendarEvent): string => {
    const calendar = calendars?.find(cal => cal.id === event.calendarId)
    return calendar?.color || colorClasses[event.color].split(" ")[0].replace("bg-[", "").replace("]", "")
  }

  const handleSyncWithGoogle = async () => {
    setIsSyncing(true)
    // API Hook: Call actual sync function here
    // Example: await syncGoogleCalendar()
    if (onSyncWithGoogle) onSyncWithGoogle()
    setTimeout(() => setIsSyncing(false), 1500) // Simulated sync
  }

  const handleReplanNow = () => {
    console.log("Replanning now")
  }

  // Handle clicking a date in month view
  const handleDateClick = (date: Date) => {
    setSelectedDate(date)
    setViewMode("1day")
  }

  const getEventStyle = (event: CalendarEvent) => {
    const top = event.startHour * 24 // 24px per hour for compact 24h view
    const height = event.duration * 24
    return {
      top: `${top}px`,
      height: `${Math.max(height, 18)}px`,
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
    const newDate = new Date(selectedDate)
    if (viewMode === "1day") {
      newDate.setDate(newDate.getDate() - 1)
    } else if (viewMode === "3days") {
      newDate.setDate(newDate.getDate() - 3)
    } else if (viewMode === "7days") {
      newDate.setDate(newDate.getDate() - 7)
    }
    setSelectedDate(newDate)
  }

  const handleNextPeriod = () => {
    const newDate = new Date(selectedDate)
    if (viewMode === "1day") {
      newDate.setDate(newDate.getDate() + 1)
    } else if (viewMode === "3days") {
      newDate.setDate(newDate.getDate() + 3)
    } else if (viewMode === "7days") {
      newDate.setDate(newDate.getDate() + 7)
    }
    setSelectedDate(newDate)
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

  // Get day names for the current view
  const getDayHeaders = () => {
    const days = []
    const startDate = new Date(selectedDate)
    
    // For 7 days view, start from Monday of current week
    if (viewMode === "7days") {
      const dayOfWeek = startDate.getDay()
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
      startDate.setDate(startDate.getDate() + mondayOffset)
    }

    const count = viewMode === "1day" ? 1 : viewMode === "3days" ? 3 : 7
    for (let i = 0; i < count; i++) {
      const date = new Date(startDate)
      date.setDate(startDate.getDate() + i)
      const isToday = date.getDate() === 11 && date.getMonth() === 3 && date.getFullYear() === 2026
      days.push({
        name: dayNames[date.getDay()],
        date: date.getDate(),
        isToday,
      })
    }
    return days
  }

  const formatDateRange = () => {
    const start = new Date(selectedDate)
    if (viewMode === "1day") {
      return `${monthNames[start.getMonth()]} ${start.getDate()}, ${start.getFullYear()}`
    } else if (viewMode === "3days") {
      const end = new Date(start)
      end.setDate(start.getDate() + 2)
      return `${monthNames[start.getMonth()]} ${start.getDate()} - ${end.getDate()}, ${start.getFullYear()}`
    } else {
      // 7 days - show week
      const dayOfWeek = start.getDay()
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
      const monday = new Date(start)
      monday.setDate(start.getDate() + mondayOffset)
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      return `${monthNames[monday.getMonth()]} ${monday.getDate()} - ${sunday.getDate()}, ${monday.getFullYear()}`
    }
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
    for (let day = 1; day <= daysInMonth; day++) {
      const isToday = day === 11 && monthViewDate.getMonth() === 3 && monthViewDate.getFullYear() === 2026
      const isSelected = selectedDate.getDate() === day && 
                         selectedDate.getMonth() === monthViewDate.getMonth() &&
                         selectedDate.getFullYear() === monthViewDate.getFullYear()
      
      days.push(
        <button
          key={day}
          onClick={() => handleDateClick(day)}
          className={`h-10 md:h-12 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center
            ${isToday ? "bg-[#3b82f6] text-white ring-2 ring-[#3b82f6] ring-offset-2 ring-offset-background" : ""}
            ${isSelected && !isToday ? "bg-secondary text-foreground" : ""}
            ${!isToday && !isSelected ? "hover:bg-secondary text-foreground" : ""}
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
                : scheduleStatus.currentMonth}
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
            <span className="text-xs text-muted-foreground font-semibold">Planner: {scheduleStatus.plannerStatus}</span>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground leading-tight font-medium">
          Schedule runs only when you click Schedule/Replan. Dragging a block pins it by default.
        </p>
      </CardHeader>
      <CardContent className="p-3 pt-0 flex-1 flex flex-col overflow-hidden">
        {/* Controls - hidden on mobile, shown on tablet+ */}
        <div className="hidden md:flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex gap-1 flex-wrap">
            <Button
              variant={tabMode === "calendars" ? "default" : "ghost"}
              size="sm"
              onClick={() => setTabMode("calendars")}
              className={`h-8 px-3 text-sm font-semibold ${
                tabMode === "calendars"
                  ? "bg-secondary text-foreground text-xs h-7 px-3 font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary text-xs h-7 px-3 font-semibold"
              }
            >
              Calendars
            </Button>
            <Button
              variant={tabMode === "schedule" ? "default" : "ghost"}
              size="sm"
              onClick={() => setTabMode("schedule")}
              className={`h-8 px-3 text-sm font-semibold ${
                tabMode === "schedule"
                  ? "bg-[#3b82f6] text-white text-xs h-7 px-3 font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary text-xs h-7 px-3 font-semibold"
              }
            >
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
              onClick={handleReplanNow}
              className="text-muted-foreground hover:text-foreground hover:bg-secondary text-xs h-7 px-3 font-semibold"
            >
              Today
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetReplan}
              className="text-muted-foreground hover:text-foreground hover:bg-secondary text-xs h-7 px-3 font-semibold"
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

        {/* Month View */}
        {viewMode === "1month" ? (
          <div className="flex-1 flex flex-col">
            {/* Month navigation */}
            <div className="flex items-center justify-center gap-4 mb-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePrevMonth}
                className="text-muted-foreground hover:text-foreground h-8 w-8 p-0"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <span className="text-base font-bold text-foreground">
                {monthNames[monthViewDate.getMonth()]} {monthViewDate.getFullYear()}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleNextMonth}
                className="text-muted-foreground hover:text-foreground h-8 w-8 p-0"
              >
                <ChevronRight className="w-5 h-5" />
              </Button>
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
          /* Calendar Grid - Day/Week View */
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Date Header with Navigation */}
            <div className="flex items-center justify-between mb-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePrevPeriod}
                className="text-muted-foreground hover:text-foreground h-8 w-8 p-0"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <span className="text-sm font-bold text-foreground">
                {formatDateRange()}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleNextPeriod}
                className="text-muted-foreground hover:text-foreground h-8 w-8 p-0"
              >
                <ChevronRight className="w-5 h-5" />
              </Button>
            </div>

            {/* Day column headers */}
            <div 
              className={`grid gap-px mb-1 ${
                viewMode === "1day" 
                  ? "grid-cols-[40px_1fr]" 
                  : viewMode === "3days" 
                  ? "grid-cols-[40px_repeat(3,1fr)]" 
                  : "grid-cols-[40px_repeat(7,1fr)]"
              }`}
            >
              <div /> {/* Empty corner for time column */}
              {getDayHeaders().map((day, idx) => (
                <div key={idx} className="text-center py-1">
                  <div className="text-xs text-muted-foreground font-semibold">{day.name}</div>
                  <div className={`text-sm font-bold ${
                    day.isToday 
                      ? "bg-[#3b82f6] text-white w-7 h-7 rounded-full flex items-center justify-center mx-auto" 
                      : "text-foreground"
                  }`}>
                    {day.date}
                  </div>
                </div>
              ))}
            </div>
            {/* Date grid */}
            <div className="grid grid-cols-7 gap-px bg-border/50">
              {getMonthGrid().map((date, i) => (
                <div
                  key={i}
                  className={`min-h-[100px] p-2 bg-card dark:bg-[#1a1a1a] ${
                    date ? "cursor-pointer hover:bg-secondary/50 dark:hover:bg-[#252525] transition-colors" : ""
                  }`}
                  onClick={() => date && handleDateClick(date)}
                >
                  {date && (
                    <>
                      <div className={`flex items-center justify-center w-8 h-8 mb-1 rounded-full text-sm font-semibold ${
                        isToday(date)
                          ? "bg-primary text-primary-foreground"
                          : "text-foreground"
                      }`}>
                        {date.getDate()}
                      </div>
                      {/* Event indicators */}
                      <div className="space-y-1">
                        {getEventsForDate(date).slice(0, 3).map((event) => (
                          <div
                            key={event.id}
                            className="flex items-center gap-1 text-xs truncate"
                            style={{ color: getEventColor(event) }}
                          >
                            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: getEventColor(event) }} />
                            <span className="truncate font-medium">{event.title}</span>
                            {event.source === "google" && (
                              <GoogleIcon className="w-3 h-3 flex-shrink-0" />
                            )}
                          </div>
                        ))}
                        {getEventsForDate(date).length > 3 && (
                          <div className="text-xs text-muted-foreground font-semibold">
                            +{getEventsForDate(date).length - 3} more
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
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

            {/* Scrollable time grid */}
            <div className="flex-1 overflow-auto">
              <div 
                className={`grid gap-px ${
                  viewMode === "1day" 
                    ? "grid-cols-[40px_1fr]" 
                    : viewMode === "3days" 
                    ? "grid-cols-[40px_repeat(3,1fr)]" 
                    : "grid-cols-[40px_repeat(7,1fr)]"
                }`}
                style={{ minHeight: `${24 * 24}px` }} // 24 hours * 24px each
              >
                {/* Time column */}
                <div className="flex flex-col">
                  {timeSlots.map((time) => (
                    <div key={time} className="h-[24px] text-[10px] text-muted-foreground pr-1 text-right flex items-start font-medium">
                      {time}
                    </div>
                  ))}
                </div>

                {/* Day columns */}
                {Array.from({ length: viewMode === "1day" ? 1 : viewMode === "3days" ? 3 : 7 }).map((_, dayIndex) => (
                  <div key={dayIndex} className="relative bg-secondary/30 border-l border-border flex-1">
                    {/* Hour lines */}
                    {timeSlots.map((_, i) => (
                      <div
                        key={i}
                        className="absolute w-full border-t border-border/50"
                        style={{ top: `${i * 24}px` }}
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
                          {/* Google icon for synced events */}
                          {event.source === "google" && <GoogleIcon />}
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
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Export mock events for use elsewhere
export { mockEvents }
