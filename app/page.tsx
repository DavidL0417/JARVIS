"use client"

import { useEffect, useState } from "react"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { WorkspaceSnapshot } from "@/components/dashboard/workspace-snapshot"
import { PanelTabs } from "@/components/dashboard/panel-tabs"
import { MasterInput } from "@/components/dashboard/master-input"
import { WhatToDoNow } from "@/components/dashboard/what-to-do-now"
import { ScheduleView } from "@/components/dashboard/schedule-view"
import { StatusPanel } from "@/components/dashboard/status-panel"
import { Button } from "@/components/ui/button"
// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER
import { getDashboardData } from "@/lib/data/dashboard"
import type { DashboardResponse } from "@/types"
// ##### END BACKEND #####
import { X } from "lucide-react"

type MobileSection = "command" | "schedule" | "status"

export default function DashboardPage() {
  const [panelsHidden, setPanelsHidden] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mobileSection, setMobileSection] = useState<MobileSection>("schedule")
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
    <div className="min-h-screen bg-[#0a0a0a] text-foreground p-3 md:p-4">
      <div className="max-w-[1600px] mx-auto">
        {/* Header */}
        <DashboardHeader 
          onTogglePanels={() => setPanelsHidden(!panelsHidden)} 
          onToggleMobileMenu={() => setMobileMenuOpen(!mobileMenuOpen)}
          panelsHidden={panelsHidden} 
        />

        {/* Mobile Navigation Menu */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 bg-[#0a0a0a] md:hidden">
            <div className="flex items-center justify-between p-4 border-b border-[#2a2a2a]">
              <h2 className="text-sm font-medium text-foreground">Navigation</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMobileMenuOpen(false)}
                className="text-muted-foreground hover:text-foreground p-2"
              >
                <X className="w-4 h-4" />
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
                  className={`w-full justify-start ${
                    mobileSection === section.id
                      ? "bg-[#3b82f6] text-white"
                      : "text-muted-foreground hover:text-foreground hover:bg-[#1f1f1f]"
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
        <div className="hidden md:block mb-3">
          <h2 className="text-xl font-bold text-foreground">Today</h2>
          <p className="text-[11px] text-muted-foreground">
            {dashboardData
              ? `${dashboardData.stats.tasks} tasks loaded from /api/dashboard`
              : "Your plan, quick actions, and schedule"}
          </p>
        </div>

        {/* Hide Panels Toggle - Desktop only */}
        <div className="hidden md:flex mb-4 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPanelsHidden(!panelsHidden)}
            className="text-muted-foreground hover:text-foreground hover:bg-[#1f1f1f] text-[11px] h-7"
          >
            {panelsHidden ? "Show Panels" : "Hide Panels"}
          </Button>
          <span className="text-[10px] text-muted-foreground">
            Focus panel open. Hide panels for a full-screen calendar view.
          </span>
        </div>

        {/* Mobile Section Navigation */}
        <div className="flex md:hidden gap-1 mb-3 bg-[#141414] rounded-lg p-1">
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
              className={`flex-1 ${
                mobileSection === section.id
                  ? "bg-[#3b82f6] text-white text-[10px] h-7"
                  : "text-muted-foreground hover:text-foreground text-[10px] h-7"
              }`}
            >
              {section.label}
            </Button>
          ))}
        </div>

        {/* Mobile Content */}
        <div className="md:hidden">
          {mobileSection === "command" && (
            <div className="flex flex-col gap-3">
              <WorkspaceSnapshot stats={dashboardData?.stats} />
              <PanelTabs />
              <MasterInput />
              <WhatToDoNow currentTask={dashboardData?.currentTask} />
            </div>
          )}
          {mobileSection === "schedule" && (
            <div className="h-[calc(100vh-180px)]">
              <ScheduleView />
            </div>
          )}
          {mobileSection === "status" && (
            <div>
              <StatusPanel stats={dashboardData?.stats} />
            </div>
          )}
        </div>

        {/* Desktop Main Content Grid - iCal compact style */}
        <div className={`hidden md:grid gap-3 ${panelsHidden ? "grid-cols-1" : "grid-cols-[280px_1fr_220px]"}`}>
          {/* Left Column - Command Center */}
          {!panelsHidden && (
            <div className="flex flex-col gap-3">
              <WorkspaceSnapshot stats={dashboardData?.stats} />
              <PanelTabs />
              <MasterInput />
              <WhatToDoNow currentTask={dashboardData?.currentTask} />
            </div>
          )}

          {/* Center Column - Schedule View */}
          <div className={`${panelsHidden ? "col-span-1" : ""} h-[calc(100vh-200px)]`}>
            <ScheduleView />
          </div>

          {/* Right Column - Status Panel */}
          {!panelsHidden && (
            <div>
              <StatusPanel stats={dashboardData?.stats} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
