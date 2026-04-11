"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { MapPin, Clock, ChevronLeft, ChevronRight, RefreshCw, Loader2 } from "lucide-react"
import { useCalendarStore, useCalendarEvents, type CalendarEvent } from "@/lib/stores/calendar-store"

type ViewMode = "1day" | "3days" | "7days" | "1month"
type TabMode = "calendars" | "schedule"

// Google "G" icon component
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

// Full 24-hour time scale
const timeSlots = Array.from({ length: 24 }, (_, i) => {
  const hour = i
  if (hour === 0) return "12 AM"
  if (hour < 12) return `${hour} AM`
  if (hour === 12) return "12 PM"
  return `${hour - 12} PM`
})

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

export function ScheduleView() {
  const [tabMode, setTabMode] = useState<TabMode>("schedule")

  // Get state and actions from store
  const { 
    calendars, 
    getVisibleEvents, 
    selectedDate, 
    viewMode, 
    setViewMode, 
    setSelectedDate,
    navigatePrevious, 
    navigateNext, 
    goToToday 
  } = useCalendarStore()
  
  const { syncStatus, lastSyncTime, syncWithGoogle } = useCalendarEvents()
  
  const events = getVisibleEvents()

  // Get the dates to display based on view mode
  const displayDates = useMemo(() => {
    const dates: Date[] = []
    const startDate = new Date(selectedDate)
    
    // For 7days view, start from Monday of the week
    if (viewMode === "7days") {
      const day = startDate.getDay()
      const diff = day === 0 ? -6 : 1 - day // Adjust to Monday
      startDate.setDate(startDate.getDate() + diff)
    }
    
    const numDays = viewMode === "1day" ? 1 : viewMode === "3days" ? 3 : viewMode === "7days" ? 7 : 0
    
    for (let i = 0; i < numDays; i++) {
      const date = new Date(startDate)
      date.setDate(date.getDate() + i)
      dates.push(date)
    }
    
    return dates
  }, [selectedDate, viewMode])

  // Check if a date is today
  const isToday = (date: Date) => {
    const today = new Date()
    return date.getDate() === today.getDate() && 
           date.getMonth() === today.getMonth() && 
           date.getFullYear() === today.getFullYear()
  }

  // Get formatted date header
  const getDateHeader = () => {
    if (viewMode === "1month") {
      return `${monthNames[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`
    }
    if (viewMode === "1day") {
      return selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    }
    if (displayDates.length > 0) {
      const start = displayDates[0]
      const end = displayDates[displayDates.length - 1]
      if (start.getMonth() === end.getMonth()) {
        return `${monthNames[start.getMonth()]} ${start.getDate()}-${end.getDate()}, ${start.getFullYear()}`
      }
      return `${monthNames[start.getMonth()]} ${start.getDate()} - ${monthNames[end.getMonth()]} ${end.getDate()}, ${start.getFullYear()}`
    }
    return ""
  }

  // Get sync status text
  const getSyncStatusText = () => {
    if (syncStatus === "syncing") return "Syncing..."
    if (syncStatus === "synced") return "Just now"
    if (lastSyncTime) {
      const diff = Date.now() - lastSyncTime.getTime()
      const minutes = Math.floor(diff / 60000)
      if (minutes < 1) return "Just now"
      if (minutes < 60) return `${minutes}m ago`
      const hours = Math.floor(minutes / 60)
      return `${hours}h ago`
    }
    return "Never"
  }

  const getEventStyle = (event: CalendarEvent) => {
    const top = event.startHour * 48 // 48px per hour
    const height = event.duration * 48
    return {
      top: `${top}px`,
      height: `${Math.max(height, 20)}px`,
    }
  }

  // Get calendar color for an event
  const getEventColor = (event: CalendarEvent) => {
    const calendar = calendars.find((c) => c.id === event.calendarId)
    return calendar?.color || "#3b82f6"
  }

  // Get text color based on background brightness
  const getTextColor = (bgColor: string) => {
    const hex = bgColor.replace("#", "")
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    const brightness = (r * 299 + g * 587 + b * 114) / 1000
    return brightness > 128 ? "#1a1a1a" : "#ffffff"
  }

  // Get events for a specific day index
  const getEventsForDay = (dayIndex: number) => {
    return events.filter((event) => event.day === dayIndex)
  }

  // Handle clicking a date in month view
  const handleDateClick = (date: Date) => {
    setSelectedDate(date)
    setViewMode("1day")
  }

  // Get month grid for month view
  const getMonthGrid = () => {
    const year = selectedDate.getFullYear()
    const month = selectedDate.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const startOffset = firstDay.getDay()
    const daysInMonth = lastDay.getDate()
    
    const grid: (Date | null)[] = []
    
    // Add empty cells for days before the first of the month
    for (let i = 0; i < startOffset; i++) {
      grid.push(null)
    }
    
    // Add days of the month
    for (let i = 1; i <= daysInMonth; i++) {
      grid.push(new Date(year, month, i))
    }
    
    return grid
  }

  // Get events for a specific date (month view)
  const getEventsForDate = (date: Date) => {
    return events.filter((event) => {
      const eventDate = new Date(event.start)
      return eventDate.getDate() === date.getDate() && 
             eventDate.getMonth() === date.getMonth() && 
             eventDate.getFullYear() === date.getFullYear()
    })
  }

  return (
    <Card className="bg-card dark:bg-[#141414] border-border dark:border-[#2a2a2a] h-full flex flex-col">
      <CardHeader className="p-4 pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base font-bold text-foreground">Schedule</CardTitle>
            <CardDescription className="text-sm font-semibold text-muted-foreground">
              {getDateHeader()}
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            {/* Sync Status */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-semibold">Last synced:</span>
              <span>{getSyncStatusText()}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncWithGoogle()}
              disabled={syncStatus === "syncing"}
              className="h-8 px-3 text-sm font-semibold"
            >
              {syncStatus === "syncing" ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              Sync with Google
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0 flex-1 flex flex-col overflow-hidden">
        {/* Navigation and View Controls */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          {/* Left side - Tab buttons */}
          <div className="hidden md:flex gap-1">
            <Button
              variant={tabMode === "calendars" ? "default" : "ghost"}
              size="sm"
              onClick={() => setTabMode("calendars")}
              className={`h-8 px-3 text-sm font-semibold ${
                tabMode === "calendars"
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              }`}
            >
              Calendars
            </Button>
            <Button
              variant={tabMode === "schedule" ? "default" : "ghost"}
              size="sm"
              onClick={() => setTabMode("schedule")}
              className={`h-8 px-3 text-sm font-semibold ${
                tabMode === "schedule"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              }`}
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
              onClick={goToToday}
              className="h-8 px-3 text-sm font-semibold"
            >
              Today
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={navigateNext}
              className="h-8 w-8"
            >
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>

          {/* Right side - View mode selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-muted-foreground">Days:</span>
            <div className="flex gap-0.5 bg-secondary/50 dark:bg-[#1a1a1a] rounded-lg p-1">
              {(["1day", "3days", "7days", "1month"] as ViewMode[]).map((mode) => (
                <Button
                  key={mode}
                  variant={viewMode === mode ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode(mode)}
                  className={`h-7 px-3 text-sm font-semibold ${
                    viewMode === mode
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {mode === "1day" ? "1 Day" : mode === "3days" ? "3 Days" : mode === "7days" ? "7 Days" : "1 Month"}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Mobile Controls */}
        <div className="flex md:hidden items-center justify-between mb-3 gap-2">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={navigatePrevious} className="h-8 w-8">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={goToToday} className="h-7 px-2 text-xs font-semibold">
              Today
            </Button>
            <Button variant="ghost" size="icon" onClick={navigateNext} className="h-8 w-8">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex gap-0.5 bg-secondary/50 dark:bg-[#1a1a1a] rounded p-0.5">
            {(["1day", "3days", "7days", "1month"] as ViewMode[]).map((mode) => (
              <Button
                key={mode}
                variant={viewMode === mode ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode(mode)}
                className={`h-7 px-2 text-xs font-semibold ${
                  viewMode === mode
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {mode === "1day" ? "1D" : mode === "3days" ? "3D" : mode === "7days" ? "7D" : "1M"}
              </Button>
            ))}
          </div>
        </div>

        {/* Calendar Grid - Month View */}
        {viewMode === "1month" ? (
          <div className="flex-1 overflow-auto">
            {/* Day headers */}
            <div className="grid grid-cols-7 gap-px mb-2">
              {dayNames.map((day) => (
                <div key={day} className="text-center text-sm font-semibold text-muted-foreground py-2">
                  {day}
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

              {/* Day columns */}
              {displayDates.map((date, dayIndex) => (
                <div key={dayIndex} className="relative bg-card dark:bg-[#1a1a1a] border-l border-border dark:border-[#2a2a2a]">
                  {/* Hour lines */}
                  {timeSlots.map((_, i) => (
                    <div
                      key={i}
                      className="absolute w-full border-t border-border/50 dark:border-[#2a2a2a]/50"
                      style={{ top: `${i * 48}px` }}
                    />
                  ))}

                  {/* Events */}
                  {getEventsForDay(dayIndex).map((event) => {
                    const bgColor = getEventColor(event)
                    const textColor = getTextColor(bgColor)
                    return (
                      <div
                        key={event.id}
                        className={`absolute left-1 right-1 rounded-md p-1.5 overflow-hidden transition-all duration-200 hover:shadow-lg ${
                          event.isReadOnly ? "opacity-90" : ""
                        }`}
                        style={{
                          ...getEventStyle(event),
                          backgroundColor: bgColor,
                          color: textColor,
                        }}
                      >
                        <div className="flex items-start justify-between">
                          <p className="text-xs font-bold truncate leading-tight flex-1">{event.title}</p>
                          {event.source === "google" && (
                            <GoogleIcon className="w-3 h-3 flex-shrink-0 ml-1 opacity-80" />
                          )}
                        </div>
                        {event.location && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <MapPin className="w-2.5 h-2.5 flex-shrink-0" />
                            <p className="text-[10px] font-medium truncate opacity-80">{event.location}</p>
                          </div>
                        )}
                        {event.time && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <Clock className="w-2.5 h-2.5 flex-shrink-0" />
                            <p className="text-[10px] font-medium truncate opacity-80">{event.time}</p>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
