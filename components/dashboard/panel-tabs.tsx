"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

// API Hook: Replace mockTabs with fetch call here if tabs are dynamic
// Example: const { data: tabs } = useSWR('/api/panels/tabs', fetcher)
const mockTabs = [
  { id: "focus", label: "Focus" },
  { id: "tasks", label: "Tasks" },
  { id: "inbox", label: "Inbox" },
  { id: "status", label: "Status" },
]

export function PanelTabs() {
  const [activeTab, setActiveTab] = useState("focus")
  // API Hook: Replace mockTabs with fetched data
  const tabs = mockTabs

  return (
    <Card className="bg-card border-border">
      <CardHeader className="p-2 pb-1">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[11px] font-medium text-foreground">Panel</CardTitle>
          <span className="text-[9px] text-muted-foreground capitalize">{activeTab}</span>
        </div>
      </CardHeader>
      <CardContent className="p-2 pt-1 space-y-1">
        <div className="flex gap-0.5">
          {tabs.map((tab) => (
            <Button
              key={tab.id}
              variant={activeTab === tab.id ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab(tab.id)}
              className={
                activeTab === tab.id
                  ? "bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[9px] h-5 px-1.5"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary text-[9px] h-5 px-1.5"
              }
            >
              {tab.label}
            </Button>
          ))}
        </div>
        <p className="text-[9px] text-muted-foreground leading-tight">
          Master input, now-task guidance, and quick actions.
        </p>
      </CardContent>
    </Card>
  )
}
