"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

const tabs = [
  { id: "focus", label: "专注" },
  { id: "tasks", label: "任务" },
  { id: "inbox", label: "收件箱" },
  { id: "status", label: "状态" },
]

export function PanelTabs() {
  const [activeTab, setActiveTab] = useState("focus")

  return (
    <Card className="bg-[#141414] border-[#2a2a2a]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-foreground">面板</CardTitle>
          <span className="text-xs text-muted-foreground">专注</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <Button
              key={tab.id}
              variant={activeTab === tab.id ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab(tab.id)}
              className={
                activeTab === tab.id
                  ? "bg-[#3b82f6] hover:bg-[#2563eb] text-white text-xs h-8"
                  : "text-muted-foreground hover:text-foreground hover:bg-[#1f1f1f] text-xs h-8"
              }
            >
              {tab.label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          主输入、当前任务指导和快捷操作。
        </p>
      </CardContent>
    </Card>
  )
}
