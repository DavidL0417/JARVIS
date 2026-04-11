"use client"

import { useEffect, useState } from "react"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { WorkspaceSnapshot } from "@/components/dashboard/workspace-snapshot"
import { PanelTabs } from "@/components/dashboard/panel-tabs"
import { MasterInput } from "@/components/dashboard/master-input"
import { WhatToDoNow } from "@/components/dashboard/what-to-do-now"
import { ScheduleView } from "@/components/dashboard/schedule-view"
import { TaskSidebar } from "@/components/dashboard/task-sidebar"
import { CalendarsSidebar } from "@/components/dashboard/calendars-sidebar"
import { Button } from "@/components/ui/button"
// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER
import { getDashboardData } from "@/lib/data/dashboard"
import type { DashboardResponse } from "@/types"
// ##### END BACKEND #####
import { X } from "lucide-react"
import { useCalendarStore } from "@/lib/stores/calendar-store"

type MobileSection = "command" | "schedule" | "status"

export default function DashboardPage() {
  const [panelsHidden, setPanelsHidden] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mobileSection, setMobileSection] = useState<MobileSection>("schedule")
  
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
          onToggleCalendarSidebar={() => setCalendarSidebarOpen(!calendarSidebarOpen)}
          panelsHidden={panelsHidden} 
        />
        
        {/* Calendar Sidebar */}
        <CalendarsSidebar 
          open={calendarSidebarOpen} 
          onOpenChange={setCalendarSidebarOpen} 
        />

        {/* Mobile Navigation Menu */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 bg-background dark:bg-[#0a0a0a] md:hidden">
            <div className="flex items-center justify-between p-4 border-b border-border dark:border-[#2a2a2a]">
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
                  className={`w-full justify-start text-base font-semibold ${
                    mobileSection === section.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50 dark:hover:bg-[#1f1f1f]"
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

        {/* Page Title - Desktop */}
        <div className="hidden md:block mb-4">
          <h2 className="text-2xl font-bold text-foreground">Today</h2>
          <p className="text-sm font-semibold text-muted-foreground">
            {dashboardData
              ? `${dashboardData.stats.tasks} tasks loaded from /api/dashboard`
              : "Your plan, quick actions, and schedule"}
          </p>
        </div>

        {/* Hide Panels Toggle - Desktop only */}
        <div className="hidden md:flex mb-4 items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPanelsHidden(!panelsHidden)}
            className="text-muted-foreground hover:text-foreground hover:bg-secondary/50 dark:hover:bg-[#1f1f1f] text-sm font-semibold h-8"
          >
            {panelsHidden ? "Show Panels" : "Hide Panels"}
          </Button>
          <span className="text-sm font-medium text-muted-foreground">
            Focus panel open. Hide panels for a full-screen calendar view.
          </span>
        </div>

        {/* Mobile Section Navigation */}
        <div className="flex md:hidden gap-1 mb-3 bg-card dark:bg-[#141414] rounded-lg p-1">
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
                  ? "bg-primary text-primary-foreground h-8"
                  : "text-muted-foreground hover:text-foreground h-8"
              }`}
            >
              {section.label}
            </Button>
          ))}
        </div>

        {/* Mobile Content */}
        <div className="md:hidden flex-1 overflow-hidden">
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
              <ScheduleView />
            </div>
          )}
          {mobileSection === "status" && (
            <div className="h-full overflow-auto">
              <TaskSidebar stats={dashboardData?.stats} />
            </div>
          )}
        </div>

        {/* Desktop Main Content Grid - iCal compact style with fit-to-screen */}
        <div className={`hidden md:grid gap-4 flex-1 overflow-hidden ${panelsHidden ? "grid-cols-1" : "grid-cols-[300px_1fr_240px]"}`}>
          {/* Left Column - Command Center */}
          {!panelsHidden && (
            <div className="flex flex-col gap-3 overflow-y-auto pr-1">
              <WorkspaceSnapshot stats={dashboardData?.stats} />
              <PanelTabs />
              <MasterInput />
              <WhatToDoNow currentTask={dashboardData?.currentTask} />
            </div>
          )}

          {/* Center Column - Schedule View - stretches to bottom */}
          <div className="overflow-hidden">
            <ScheduleView />
          </div>

          {/* Right Column - Task Sidebar */}
          {!panelsHidden && (
            <div className="overflow-y-auto pl-1">
              <TaskSidebar stats={dashboardData?.stats} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
