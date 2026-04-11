"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { MapPin, Clock } from "lucide-react"
import { useCalendarStore, type CalendarEvent } from "@/lib/stores/calendar-store"

type ViewMode = "1day" | "3days" | "7days"
type TabMode = "calendars" | "schedule"

// API Hook: Replace mockScheduleStatus with fetch call here
// Example: const { data: scheduleStatus } = useSWR('/api/schedule/status', fetcher)
const mockScheduleStatus = {
  plannerStatus: "Not scheduled",
  currentMonth: "April 2026",
}

const timeSlots = ["10AM", "11AM", "12PM", "1PM", "2PM", "3PM", "4PM", "5PM", "6PM", "7PM", "8PM"]

const days = ["", "", "", "", "", "", ""]

export function ScheduleView() {
  const [viewMode, setViewMode] = useState<ViewMode>("7days")
  const [tabMode, setTabMode] = useState<TabMode>("schedule")

  // Get events and calendars from store with visibility filtering
  const { calendars, getVisibleEvents } = useCalendarStore()
  const events = getVisibleEvents()

  // API Hook: Replace mockScheduleStatus with fetched data
  const scheduleStatus = mockScheduleStatus

  // API Hook: Replace with actual schedule action handlers
  // Example: const { trigger: replanNow } = useSWRMutation('/api/schedule/replan', postFetcher)
  const handleReplanNow = () => {
    console.log("Replanning now")
  }

  const handleResetReplan = () => {
    console.log("Reset and replan")
  }

  const getEventStyle = (event: CalendarEvent) => {
    const top = (event.startHour - 10) * 48 // 48px per hour (compact)
    const height = event.duration * 48
    return {
      top: `${top}px`,
      height: `${height}px`,
    }
  }

  // Get calendar color for an event
  const getEventColor = (event: CalendarEvent) => {
    const calendar = calendars.find((c) => c.id === event.calendarId)
    return calendar?.color || "#3b82f6"
  }

  // Get text color based on background brightness
  const getTextColor = (bgColor: string) => {
    // Simple brightness check - dark colors get white text
    const hex = bgColor.replace("#", "")
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    const brightness = (r * 299 + g * 587 + b * 114) / 1000
    return brightness > 128 ? "#1a1a1a" : "#ffffff"
  }

  return (
    <Card className="bg-[#141414] border-[#2a2a2a] h-full flex flex-col">
      <CardHeader className="p-3 pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xs font-medium text-foreground">Schedule</CardTitle>
            <CardDescription className="text-[10px] text-muted-foreground">
              {scheduleStatus.currentMonth}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Planner: {scheduleStatus.plannerStatus}</span>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground leading-tight">
          Schedule runs only when you click Schedule/Replan. Dragging a block pins it by default.
        </p>
      </CardHeader>
      <CardContent className="p-3 pt-0 flex-1 flex flex-col overflow-hidden">
        {/* Controls - hidden on mobile, shown on tablet+ */}
        <div className="hidden md:flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex gap-0.5 flex-wrap">
            <Button
              variant={tabMode === "calendars" ? "default" : "ghost"}
              size="sm"
              onClick={() => setTabMode("calendars")}
              className={
                tabMode === "calendars"
                  ? "bg-[#2a2a2a] text-white text-[10px] h-6 px-2"
                  : "text-muted-foreground hover:text-foreground hover:bg-[#1f1f1f] text-[10px] h-6 px-2"
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
                  ? "bg-[#3b82f6] text-white text-[10px] h-6 px-2"
                  : "text-muted-foreground hover:text-foreground hover:bg-[#1f1f1f] text-[10px] h-6 px-2"
              }
            >
              Schedule
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReplanNow}
              className="text-muted-foreground hover:text-foreground hover:bg-[#1f1f1f] text-[10px] h-6 px-2"
            >
              Replan Now
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetReplan}
              className="text-muted-foreground hover:text-foreground hover:bg-[#1f1f1f] text-[10px] h-6 px-2"
            >
              Reset & Replan
            </Button>
          </div>
          <div className="flex gap-0.5 bg-[#1a1a1a] rounded p-0.5">
            {(["1day", "3days", "7days"] as ViewMode[]).map((mode) => (
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
                {mode === "1day" ? "1 Day" : mode === "3days" ? "3 Days" : "7 Days"}
              </Button>
            ))}
          </div>
        </div>

        {/* Mobile Controls */}
        <div className="flex md:hidden items-center justify-between mb-2 gap-2">
          <div className="flex gap-0.5 bg-[#1a1a1a] rounded p-0.5">
            {(["1day", "3days", "7days"] as ViewMode[]).map((mode) => (
              <Button
                key={mode}
                variant={viewMode === mode ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode(mode)}
                className={
                  viewMode === mode
                    ? "bg-[#3b82f6] text-white text-[10px] h-6 px-2"
                    : "text-muted-foreground hover:text-foreground text-[10px] h-6 px-2"
                }
              >
                {mode === "1day" ? "1D" : mode === "3days" ? "3D" : "7D"}
              </Button>
            ))}
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="flex-1 overflow-auto relative">
          <div 
            className={`grid gap-px min-h-[528px] ${
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
                <div key={time} className="h-[48px] text-[10px] text-muted-foreground pr-1 text-right flex items-start">
                  {time}
                </div>
              ))}
            </div>

            {/* Day columns */}
            {days
              .slice(0, viewMode === "1day" ? 1 : viewMode === "3days" ? 3 : 7)
              .map((day, dayIndex) => (
                <div key={dayIndex} className="relative bg-[#1a1a1a] border-l border-[#2a2a2a]">
                  {/* Hour lines */}
                  {timeSlots.map((_, i) => (
                    <div
                      key={i}
                      className="absolute w-full border-t border-[#2a2a2a]/50"
                      style={{ top: `${i * 48}px` }}
                    />
                  ))}

                  {/* Events - filtered by calendar visibility */}
                  {events
                    .filter((event) => event.day === dayIndex)
                    .map((event) => {
                      const bgColor = getEventColor(event)
                      const textColor = getTextColor(bgColor)
                      return (
                        <div
                          key={event.id}
                          className="absolute left-0.5 right-0.5 rounded p-1 overflow-hidden transition-opacity duration-200"
                          style={{
                            ...getEventStyle(event),
                            backgroundColor: bgColor,
                            color: textColor,
                          }}
                        >
                          <p className="text-[9px] font-medium truncate leading-tight">{event.title}</p>
                          {event.location && (
                            <div className="flex items-center gap-0.5 mt-0.5">
                              <MapPin className="w-2 h-2 flex-shrink-0" />
                              <p className="text-[8px] truncate opacity-80">{event.location}</p>
                            </div>
                          )}
                          {event.time && (
                            <div className="flex items-center gap-0.5 mt-0.5">
                              <Clock className="w-2 h-2 flex-shrink-0" />
                              <p className="text-[8px] truncate opacity-80">{event.time}</p>
                            </div>
                          )}
                        </div>
                      )
                    })}
                </div>
              ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
