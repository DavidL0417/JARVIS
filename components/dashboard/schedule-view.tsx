"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { MapPin, Clock } from "lucide-react"

type ViewMode = "1day" | "3days" | "7days"
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

const events: Event[] = [
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

const colorClasses: Record<Event["color"], string> = {
  mint: "bg-[#4ade80] text-[#052e16]",
  blue: "bg-[#3b82f6] text-white",
  yellow: "bg-[#fde047] text-[#422006]",
  orange: "bg-[#fb923c] text-[#431407]",
  purple: "bg-[#c084fc] text-[#3b0764]",
  cyan: "bg-[#22d3ee] text-[#083344]",
}

const timeSlots = [
  "10AM", "11AM", "12PM", "1PM", "2PM", "3PM", "4PM", "5PM", "6PM", "7PM", "8PM"
]

const days = ["", "", "", "", "", "", ""]

export function ScheduleView() {
  const [viewMode, setViewMode] = useState<ViewMode>("7days")
  const [tabMode, setTabMode] = useState<TabMode>("schedule")

  const getEventStyle = (event: Event) => {
    const top = (event.startHour - 10) * 60 // 60px per hour
    const height = event.duration * 60
    return {
      top: `${top}px`,
      height: `${height}px`,
    }
  }

  return (
    <Card className="bg-[#141414] border-[#2a2a2a] h-full flex flex-col">
      <CardHeader className="pb-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium text-foreground">日程安排</CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              2026年4月
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">计划器: 未安排</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          仅当您点击"安排/重新规划"时才会运行计划。拖动块默认会固定它。
        </p>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-1">
            <Button
              variant={tabMode === "calendars" ? "default" : "ghost"}
              size="sm"
              onClick={() => setTabMode("calendars")}
              className={
                tabMode === "calendars"
                  ? "bg-[#2a2a2a] text-white text-xs h-8"
                  : "text-muted-foreground hover:text-foreground hover:bg-[#1f1f1f] text-xs h-8"
              }
            >
              日历
            </Button>
            <Button
              variant={tabMode === "schedule" ? "default" : "ghost"}
              size="sm"
              onClick={() => setTabMode("schedule")}
              className={
                tabMode === "schedule"
                  ? "bg-[#3b82f6] text-white text-xs h-8"
                  : "text-muted-foreground hover:text-foreground hover:bg-[#1f1f1f] text-xs h-8"
              }
            >
              安排
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground hover:bg-[#1f1f1f] text-xs h-8"
            >
              立即重新规划
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground hover:bg-[#1f1f1f] text-xs h-8"
            >
              重置并重新规划
            </Button>
          </div>
          <div className="flex gap-1 bg-[#1a1a1a] rounded-lg p-1">
            {(["1day", "3days", "7days"] as ViewMode[]).map((mode) => (
              <Button
                key={mode}
                variant={viewMode === mode ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode(mode)}
                className={
                  viewMode === mode
                    ? "bg-[#3b82f6] text-white text-xs h-7 px-3"
                    : "text-muted-foreground hover:text-foreground text-xs h-7 px-3"
                }
              >
                {mode === "1day" ? "1天" : mode === "3days" ? "3天" : "7天"}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto relative">
          <div className="grid grid-cols-8 gap-px min-h-[660px]">
            {/* Time column */}
            <div className="flex flex-col">
              {timeSlots.map((time, i) => (
                <div key={time} className="h-[60px] text-xs text-muted-foreground pr-2 text-right">
                  {time}
                </div>
              ))}
            </div>

            {/* Day columns */}
            {days.map((day, dayIndex) => (
              <div key={dayIndex} className="relative bg-[#1a1a1a] border-l border-[#2a2a2a]">
                {/* Hour lines */}
                {timeSlots.map((_, i) => (
                  <div
                    key={i}
                    className="absolute w-full border-t border-[#2a2a2a]"
                    style={{ top: `${i * 60}px` }}
                  />
                ))}

                {/* Events */}
                {events
                  .filter((event) => event.day === dayIndex)
                  .map((event) => (
                    <div
                      key={event.id}
                      className={`absolute left-1 right-1 rounded-lg p-1.5 overflow-hidden ${colorClasses[event.color]}`}
                      style={getEventStyle(event)}
                    >
                      <p className="text-xs font-medium truncate leading-tight">{event.title}</p>
                      {event.location && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <MapPin className="w-2.5 h-2.5 flex-shrink-0" />
                          <p className="text-[10px] truncate opacity-80">{event.location}</p>
                        </div>
                      )}
                      {event.time && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Clock className="w-2.5 h-2.5 flex-shrink-0" />
                          <p className="text-[10px] truncate opacity-80">{event.time}</p>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            ))}
          </div>

          {/* No plan overlay */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-[#1f1f1f]/95 backdrop-blur-sm rounded-lg px-6 py-4 text-center border border-[#2a2a2a] pointer-events-auto">
              <p className="text-sm font-medium text-foreground mb-1">尚无计划</p>
              <p className="text-xs text-muted-foreground">
                点击"安排"运行AI规划您的硬约束。
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
