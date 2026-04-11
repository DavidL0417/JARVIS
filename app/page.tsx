"use client"

import { useState } from "react"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { WorkspaceSnapshot } from "@/components/dashboard/workspace-snapshot"
import { PanelTabs } from "@/components/dashboard/panel-tabs"
import { MasterInput } from "@/components/dashboard/master-input"
import { WhatToDoNow } from "@/components/dashboard/what-to-do-now"
import { ScheduleView } from "@/components/dashboard/schedule-view"
import { StatusPanel } from "@/components/dashboard/status-panel"
import { Button } from "@/components/ui/button"

export default function DashboardPage() {
  const [panelsHidden, setPanelsHidden] = useState(false)

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-foreground p-6">
      <div className="max-w-[1800px] mx-auto">
        {/* Header */}
        <DashboardHeader 
          onTogglePanels={() => setPanelsHidden(!panelsHidden)} 
          panelsHidden={panelsHidden} 
        />

        {/* Page Title */}
        <div className="mb-4">
          <h2 className="text-3xl font-bold text-foreground">今日</h2>
          <p className="text-sm text-muted-foreground">您的计划、快捷操作和日程安排</p>
        </div>

        {/* Hide Panels Toggle */}
        <div className="mb-6 flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPanelsHidden(!panelsHidden)}
            className="text-muted-foreground hover:text-foreground hover:bg-[#1f1f1f] text-sm"
          >
            {panelsHidden ? "显示面板" : "隐藏面板"}
          </Button>
          <span className="text-xs text-muted-foreground">
            专注面板已打开。隐藏面板以获得全屏日历视图。
          </span>
        </div>

        {/* Main Content Grid */}
        <div className={`grid gap-6 ${panelsHidden ? "grid-cols-1" : "grid-cols-[1fr_2fr_1fr]"}`}>
          {/* Left Column - Command Center */}
          {!panelsHidden && (
            <div className="flex flex-col gap-4">
              <WorkspaceSnapshot />
              <PanelTabs />
              <MasterInput />
              <WhatToDoNow />
            </div>
          )}

          {/* Center Column - Schedule View */}
          <div className={panelsHidden ? "col-span-1" : ""}>
            <ScheduleView />
          </div>

          {/* Right Column - Status Panel */}
          {!panelsHidden && (
            <div>
              <StatusPanel />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
