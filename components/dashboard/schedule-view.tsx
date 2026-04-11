"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { MapPin, Clock, ChevronLeft, ChevronRight } from "lucide-react"

type ViewMode = "1day" | "3days" | "7days" | "1month"
type TabMode = "calendars" | "schedule"

interface Event {
  id: string
  title: string
  location?: string
  time?: string
  color: "mint" | "blue" | "yellow" | "orange" | "purple" | "cyan"
  day: number
  startHour: number
  duration: number
}

// API Hook: Replace mockEvents with fetch call here
// Example: const { data: events } = useSWR('/api/schedule/events', fetcher)
const mockEvents: Event[] = [
  // Monday (day 0)
  { id: "1", title: "MATH 240-0", location: "Lunt 105", color: "mint", day: 0, startHour: 10, duration: 1 },
  { id: "2", title: "HISTORY 38...", location: "Locy Hall 111", color: "blue", day: 0, startHour: 11, duration: 1 },
  { id: "3", title: "PHIL 101-8 O...", location: "Crowe 3-178", time: "2:30 PM-3:...", color: "cyan", day: 0, startHour: 15, duration: 0.5 },
  { id: "4", title: "PHIL 101-8 (seminar)", location: "Shepard Ha...", color: "cyan", day: 0, startHour: 16, duration: 1 },
  { id: "5", title: "Project Vela...", color: "orange", day: 0, startHour: 16.5, duration: 0.5 },
  { id: "6", title: "PAD Meeting", location: "University...", time: "6:00 PM-7:...", color: "purple", day: 0, startHour: 18, duration: 2.5 },

  // Tuesday (day 1)
  { id: "7", title: "MATH 240-0...", location: "Lunt Hall 103", color: "mint", day: 1, startHour: 10, duration: 1 },
  { id: "8", title: "LEGAL_ST 221-0", location: "Harris Hall...", time: "12:30 PM-1:...", color: "yellow", day: 1, startHour: 13, duration: 1 },
  { id: "9", title: "COMP_SCI 397-0 (semi...", location: "RB135 - Th...", time: "2:35 PM-5:...", color: "yellow", day: 1, startHour: 14.5, duration: 2.5 },
  { id: "10", title: "Project Vela...", color: "orange", day: 1, startHour: 16.5, duration: 1.5 },

  // Wednesday (day 2)
  { id: "11", title: "HISTORY 38...", location: "Locy Hall 111", color: "blue", day: 2, startHour: 11, duration: 1 },
  { id: "12", title: "PHIL 101-8 O...", location: "Crowe 3-178", time: "2:30 PM-3:...", color: "cyan", day: 2, startHour: 15, duration: 0.5 },
  { id: "13", title: "PHIL 101-8 (seminar)", location: "Shepard Ha...", color: "cyan", day: 2, startHour: 16, duration: 1 },
  { id: "14", title: "Project Vela...", color: "orange", day: 2, startHour: 16.5, duration: 0.5 },
  { id: "15", title: "Feiyi Recital", location: "Galvin Reci...", time: "6:00 PM-7:...", color: "cyan", day: 2, startHour: 18, duration: 1 },

  // Thursday (day 3)
  { id: "16", title: "LEGAL_ST 221-0", location: "Harris Hall...", time: "12:30 PM-1:...", color: "yellow", day: 3, startHour: 13, duration: 1 },
  { id: "17", title: "LEGAL_ST 2...", location: "Kresge Cen...", color: "yellow", day: 3, startHour: 16, duration: 1 },
  { id: "18", title: "Project Vela...", color: "orange", day: 3, startHour: 16.5, duration: 0.5 },
  { id: "19", title: "Dinner w Evan", time: "6:00 PM-7:...", color: "cyan", day: 3, startHour: 18, duration: 1 },

  // Friday (day 4)
  { id: "20", title: "MATH 240-0", location: "Lunt 105", color: "mint", day: 4, startHour: 10, duration: 1 },
  { id: "21", title: "HISTORY 38...", location: "Locy Hall 111", color: "blue", day: 4, startHour: 11, duration: 1 },
  { id: "22", title: "Innovation L...", location: "Microsoft T...", color: "orange", day: 4, startHour: 13, duration: 1 },
  { id: "23", title: "HISTORY 38...", location: "Kresge Cen...", color: "blue", day: 4, startHour: 14, duration: 1 },
  { id: "24", title: "Project Vela...", color: "orange", day: 4, startHour: 16.5, duration: 0.5 },
  { id: "25", title: "Hotpot", time: "6:00 PM-9:...", color: "cyan", day: 4, startHour: 18, duration: 3 },
]

// API Hook: Replace mockScheduleStatus with fetch call here
const mockScheduleStatus = {
  plannerStatus: "Not scheduled",
  currentMonth: "April 2026",
}

const colorClasses: Record<Event["color"], string> = {
  mint: "bg-[#4ade80] text-[#052e16]",
  blue: "bg-[#3b82f6] text-white",
  yellow: "bg-[#fde047] text-[#422006]",
  orange: "bg-[#fb923c] text-[#431407]",
  purple: "bg-[#c084fc] text-[#3b0764]",
  cyan: "bg-[#22d3ee] text-[#083344]",
}

const timeSlots = ["10AM", "11AM", "12PM", "1PM", "2PM", "3PM", "4PM", "5PM", "6PM", "7PM", "8PM"]

export function ScheduleView() {
  const [viewMode, setViewMode] = useState<ViewMode>("7days")
  const [tabMode, setTabMode] = useState<TabMode>("schedule")
  const [selectedDate, setSelectedDate] = useState<Date>(new Date(2026, 3, 11)) // April 11, 2026
  const [monthViewDate, setMonthViewDate] = useState<Date>(new Date(2026, 3, 1)) // April 2026

  const events = mockEvents
  const scheduleStatus = mockScheduleStatus

  const handleReplanNow = () => {
    console.log("Replanning now")
  }

  const handleResetReplan = () => {
    console.log("Reset and replan")
  }

  const getEventStyle = (event: Event) => {
    const top = (event.startHour - 10) * 40 // 40px per hour (compact)
    const height = event.duration * 40
    return {
      top: `${top}px`,
      height: `${Math.max(height, 20)}px`,
    }
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

  const renderMonthView = () => {
    const daysInMonth = getDaysInMonth(monthViewDate)
    const firstDay = getFirstDayOfMonth(monthViewDate)
    const days = []
    
    // Empty cells for days before the first day of the month
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="h-8 md:h-10" />)
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
          className={`h-8 md:h-10 rounded text-xs md:text-sm font-medium transition-colors
            ${isToday ? "bg-[#3b82f6] text-white" : ""}
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
      <CardHeader className="p-2 pb-1 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xs font-medium text-foreground">Schedule</CardTitle>
            <CardDescription className="text-[10px] text-muted-foreground">
              {viewMode === "1month" 
                ? `${monthNames[monthViewDate.getMonth()]} ${monthViewDate.getFullYear()}`
                : scheduleStatus.currentMonth}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Planner: {scheduleStatus.plannerStatus}</span>
          </div>
        </div>
        <p className="text-[9px] text-muted-foreground leading-tight">
          Schedule runs only when you click Schedule/Replan. Dragging a block pins it by default.
        </p>
      </CardHeader>
      <CardContent className="p-2 pt-0 flex-1 flex flex-col overflow-hidden">
        {/* Controls - hidden on mobile, shown on tablet+ */}
        <div className="hidden md:flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="flex gap-0.5 flex-wrap">
            <Button
              variant={tabMode === "calendars" ? "default" : "ghost"}
              size="sm"
              onClick={() => setTabMode("calendars")}
              className={
                tabMode === "calendars"
                  ? "bg-secondary text-foreground text-[10px] h-5 px-2"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary text-[10px] h-5 px-2"
              }
            >
              Calendars
            </Button>
            <Button
              variant={tabMode === "schedule" ? "default" : "ghost"}
              size="sm"
              onClick={() => setTabMode("schedule")}
              className={
                tabMode === "schedule"
                  ? "bg-[#3b82f6] text-white text-[10px] h-5 px-2"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary text-[10px] h-5 px-2"
              }
            >
              Schedule
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReplanNow}
              className="text-muted-foreground hover:text-foreground hover:bg-secondary text-[10px] h-5 px-2"
            >
              Replan Now
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetReplan}
              className="text-muted-foreground hover:text-foreground hover:bg-secondary text-[10px] h-5 px-2"
            >
              Reset & Replan
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Days:</span>
            <div className="flex gap-0.5 bg-secondary/50 rounded p-0.5">
              {(["1day", "3days", "7days", "1month"] as ViewMode[]).map((mode) => (
                <Button
                  key={mode}
                  variant={viewMode === mode ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode(mode)}
                  className={
                    viewMode === mode
                      ? "bg-[#3b82f6] text-white text-[10px] h-5 px-2"
                      : "text-muted-foreground hover:text-foreground text-[10px] h-5 px-2"
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
          <span className="text-[10px] text-muted-foreground">Days:</span>
          <div className="flex gap-0.5 bg-secondary/50 rounded p-0.5">
            {(["1day", "3days", "7days", "1month"] as ViewMode[]).map((mode) => (
              <Button
                key={mode}
                variant={viewMode === mode ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode(mode)}
                className={
                  viewMode === mode
                    ? "bg-[#3b82f6] text-white text-[9px] h-5 px-1.5"
                    : "text-muted-foreground hover:text-foreground text-[9px] h-5 px-1.5"
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
            <div className="flex items-center justify-between mb-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePrevMonth}
                className="text-muted-foreground hover:text-foreground h-6 w-6 p-0"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm font-medium text-foreground">
                {monthNames[monthViewDate.getMonth()]} {monthViewDate.getFullYear()}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleNextMonth}
                className="text-muted-foreground hover:text-foreground h-6 w-6 p-0"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            
            {/* Day headers */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <div key={day} className="text-center text-[10px] text-muted-foreground font-medium">
                  {day}
                </div>
              ))}
            </div>
            
            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1 flex-1">
              {renderMonthView()}
            </div>
            
            <p className="text-[10px] text-muted-foreground text-center mt-2">
              Click a date to view that day
            </p>
          </div>
        ) : (
          /* Calendar Grid - Day/Week View */
          <div className="flex-1 overflow-auto relative">
            <div 
              className={`grid gap-px min-h-[440px] ${
                viewMode === "1day" 
                  ? "grid-cols-2" 
                  : viewMode === "3days" 
                  ? "grid-cols-4" 
                  : "grid-cols-8"
              }`}
            >
              {/* Time column */}
              <div className="flex flex-col">
                {timeSlots.map((time) => (
                  <div key={time} className="h-[40px] text-[9px] text-muted-foreground pr-1 text-right flex items-start">
                    {time}
                  </div>
                ))}
              </div>

              {/* Day columns */}
              {Array.from({ length: viewMode === "1day" ? 1 : viewMode === "3days" ? 3 : 7 }).map((_, dayIndex) => (
                <div key={dayIndex} className="relative bg-secondary/30 border-l border-border">
                  {/* Hour lines */}
                  {timeSlots.map((_, i) => (
                    <div
                      key={i}
                      className="absolute w-full border-t border-border/50"
                      style={{ top: `${i * 40}px` }}
                    />
                  ))}

                  {/* Events */}
                  {events
                    .filter((event) => event.day === dayIndex)
                    .map((event) => (
                      <div
                        key={event.id}
                        className={`absolute left-0.5 right-0.5 rounded px-1 py-0.5 overflow-hidden ${colorClasses[event.color]}`}
                        style={getEventStyle(event)}
                      >
                        <p className="text-[8px] font-medium truncate leading-tight">{event.title}</p>
                        {event.location && event.duration >= 0.75 && (
                          <div className="flex items-center gap-0.5">
                            <MapPin className="w-2 h-2 flex-shrink-0" />
                            <p className="text-[7px] truncate opacity-80">{event.location}</p>
                          </div>
                        )}
                        {event.time && event.duration >= 1 && (
                          <div className="flex items-center gap-0.5">
                            <Clock className="w-2 h-2 flex-shrink-0" />
                            <p className="text-[7px] truncate opacity-80">{event.time}</p>
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
