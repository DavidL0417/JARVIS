"use client"

import { useState, useEffect } from "react"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { WorkspaceSnapshot } from "@/components/dashboard/workspace-snapshot"
import { PanelTabs } from "@/components/dashboard/panel-tabs"
import { MasterInput } from "@/components/dashboard/master-input"
import { WhatToDoNow } from "@/components/dashboard/what-to-do-now"
import { ScheduleView } from "@/components/dashboard/schedule-view"
import { StatusPanel } from "@/components/dashboard/status-panel"
import { CalendarsSidebar, initialCalendars, type Calendar } from "@/components/dashboard/calendars-sidebar"
import { TaskManager, initialTasks, type Task } from "@/components/dashboard/task-manager"
import { Button } from "@/components/ui/button"
import { TaskSidebar } from "@/components/dashboard/task-sidebar"
import { X, Book } from "lucide-react"
// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER
import { getDashboardData } from "@/lib/data/dashboard"
import type { DashboardResponse } from "@/types"
// ##### END BACKEND #####

type MobileSection = "command" | "schedule" | "status"

export default function DashboardPage() {
  const [panelsHidden, setPanelsHidden] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mobileSection, setMobileSection] = useState<MobileSection>("schedule")
  const [isDarkMode, setIsDarkMode] = useState(true)
  
  // Calendar management state
  const [calendarsSidebarOpen, setCalendarsSidebarOpen] = useState(false)
  const [calendars, setCalendars] = useState<Calendar[]>(initialCalendars)
  const [activeCalendarId, setActiveCalendarId] = useState<string | null>(null)
  
  // Task management state
  const [tasks, setTasks] = useState<Task[]>(initialTasks)

  // Get visible calendar IDs for filtering events
  const visibleCalendarIds = calendars.filter(cal => cal.isVisible).map(cal => cal.id)
  
  // Get the active calendar object
  const activeCalendar = activeCalendarId 
    ? calendars.find(cal => cal.id === activeCalendarId) || null 
    : null

  // Toggle dark/light mode
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
  }, [isDarkMode])

  const handleToggleTheme = () => {
    setIsDarkMode(!isDarkMode)
  }

  // API Hook: Replace with actual Google Calendar sync
  const handleSyncWithGoogle = () => {
    console.log("Syncing with Google Calendar...")
  }

  const handleOpenCalendarsSidebar = () => {
    setCalendarsSidebarOpen(true)
  }

  return (
    <div className={`h-screen overflow-hidden text-foreground p-3 md:p-4 ${isDarkMode ? "bg-[#0a0a0a]" : "bg-gray-50"}`}>
      <div className="max-w-[1600px] mx-auto h-full flex flex-col">
  
  // Calendar sidebar state
  const { calendarSidebarOpen, setCalendarSidebarOpen } = useCalendarStore()
  
  // ##### BACKEND API #####
  // DO NOT MODIFY UNLESS BACKEND OWNER
  const [dashboardData, setDashboardData] = useState<DashboardResponse | null>(null)

  useEffect(() => {
    let isActive = true

    async function loadDashboard() {
      const data = await getDashboardData()

      if (!isActive || !data) {
        return
      }

      console.log("Loaded dashboard data", data)
      setDashboardData(data)
    }

    loadDashboard()

    return () => {
      isActive = false
    }
  }, [])
  // ##### END BACKEND #####

  return (
    <div className="min-h-screen bg-background dark:bg-[#0a0a0a] text-foreground p-4 md:p-5">
      <div className="max-w-[1800px] mx-auto h-[calc(100vh-40px)] flex flex-col">
        {/* Header */}
        <DashboardHeader 
          onTogglePanels={() => setPanelsHidden(!panelsHidden)} 
          onToggleMobileMenu={() => setMobileMenuOpen(!mobileMenuOpen)}
          onToggleTheme={handleToggleTheme}
          onOpenCalendars={handleOpenCalendarsSidebar}
          panelsHidden={panelsHidden}
          isDarkMode={isDarkMode}
        />

        {/* Calendars Sidebar - Slide-in from left */}
        <CalendarsSidebar
          isOpen={calendarsSidebarOpen}
          onClose={() => setCalendarsSidebarOpen(false)}
          calendars={calendars}
          onCalendarsChange={setCalendars}
          onSelectCalendar={setActiveCalendarId}
          activeCalendarId={activeCalendarId}
        />
        
        {/* Calendar Sidebar */}
        <CalendarsSidebar 
          open={calendarSidebarOpen} 
          onOpenChange={setCalendarSidebarOpen} 
        />

        {/* Mobile Navigation Menu */}
        {mobileMenuOpen && (
          <div className={`fixed inset-0 z-50 ${isDarkMode ? "bg-[#0a0a0a]" : "bg-gray-50"} md:hidden`}>
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-base font-bold text-foreground">Navigation</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMobileMenuOpen(false)}
                className="text-muted-foreground hover:text-foreground p-2"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
            <div className="p-4 space-y-2">
              {[
                { id: "command" as const, label: "Command Center" },
                { id: "schedule" as const, label: "Schedule" },
                { id: "status" as const, label: "Status" },
              ].map((section) => (
                <Button
                  key={section.id}
                  variant={mobileSection === section.id ? "default" : "ghost"}
                  className={`w-full justify-start text-sm font-semibold ${
                    mobileSection === section.id
                      ? "bg-[#3b82f6] text-white"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                  onClick={() => {
                    setMobileSection(section.id)
                    setMobileMenuOpen(false)
                  }}
                >
                  {section.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Hide Panels Toggle - Desktop only */}
        <div className="hidden md:flex mb-3 items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPanelsHidden(!panelsHidden)}
            className="text-muted-foreground hover:text-foreground hover:bg-secondary text-xs h-7 font-semibold"
          >
            {panelsHidden ? "Show Panels" : "Hide Panels"}
          </Button>
          <span className="text-xs text-muted-foreground font-medium">
            Focus panel open. Hide panels for a full-screen calendar view.
          </span>
        </div>

        {/* Mobile Section Navigation */}
        <div className="flex md:hidden gap-1 mb-3 bg-secondary/50 rounded-lg p-0.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleOpenCalendarsSidebar}
            className="text-muted-foreground hover:text-foreground h-7 w-9 p-0"
          >
            <Book className="w-4 h-4" />
          </Button>
          {[
            { id: "command" as const, label: "Command" },
            { id: "schedule" as const, label: "Schedule" },
            { id: "status" as const, label: "Status" },
          ].map((section) => (
            <Button
              key={section.id}
              variant={mobileSection === section.id ? "default" : "ghost"}
              size="sm"
              onClick={() => setMobileSection(section.id)}
              className={`flex-1 text-sm font-semibold ${
                mobileSection === section.id
                  ? "bg-[#3b82f6] text-white text-xs h-7 font-semibold"
                  : "text-muted-foreground hover:text-foreground text-xs h-7 font-semibold"
              }`}
            >
              {section.label}
            </Button>
          ))}
        </div>

        {/* Mobile Content */}
        <div className="md:hidden flex-1 overflow-auto">
          {mobileSection === "command" && (
            <div className="flex flex-col gap-3 h-full overflow-auto">
              <WorkspaceSnapshot stats={dashboardData?.stats} />
              <PanelTabs />
              <MasterInput />
              <WhatToDoNow currentTask={dashboardData?.currentTask} />
            </div>
          )}
          {mobileSection === "schedule" && (
            <div className="h-full">
              <ScheduleView 
                onSyncWithGoogle={handleSyncWithGoogle}
                visibleCalendarIds={visibleCalendarIds}
                calendars={calendars}
              />
            </div>
          )}
          {mobileSection === "status" && (
            <div>
              {activeCalendar ? (
                <TaskManager 
                  calendar={activeCalendar}
                  tasks={tasks}
                  onTasksChange={setTasks}
                />
              ) : (
                <StatusPanel />
              )}
            </div>
          )}
        </div>

        {/* Desktop Main Content Grid - iCal compact style, fit to screen */}
        <div className={`hidden md:grid gap-3 flex-1 overflow-hidden ${panelsHidden ? "grid-cols-1" : "grid-cols-[280px_1fr_220px]"}`}>
          {/* Left Column - Command Center */}
          {!panelsHidden && (
            <div className="flex flex-col gap-3 overflow-auto">
              <WorkspaceSnapshot />
              <PanelTabs />
              <MasterInput />
              <WhatToDoNow currentTask={dashboardData?.currentTask} />
            </div>
          )}

          {/* Center Column - Schedule View */}
          <div className={`${panelsHidden ? "col-span-1" : ""} overflow-hidden`}>
            <ScheduleView 
              onSyncWithGoogle={handleSyncWithGoogle}
              visibleCalendarIds={visibleCalendarIds}
              calendars={calendars}
            />
          </div>

          {/* Right Column - Status Panel or Task Manager */}
          {!panelsHidden && (
            <div className="overflow-auto">
              {activeCalendar ? (
                <TaskManager 
                  calendar={activeCalendar}
                  tasks={tasks}
                  onTasksChange={setTasks}
                />
              ) : (
                <StatusPanel />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
