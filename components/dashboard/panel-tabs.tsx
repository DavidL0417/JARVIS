"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export type PanelTabId = "focus" | "tasks" | "inbox" | "status"

const panelTabs: Array<{ id: PanelTabId; label: string }> = [
  { id: "focus", label: "Focus" },
  { id: "tasks", label: "Tasks" },
  { id: "inbox", label: "Inbox" },
  { id: "status", label: "Status" },
]

interface PanelTabsProps {
  activeTab: PanelTabId
  onTabChange: (tab: PanelTabId) => void
}

export function PanelTabs({ activeTab, onTabChange }: PanelTabsProps) {

  return (
    <Card className="bg-card border-border">
      <CardHeader className="p-3 pb-1">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold text-foreground">Panel</CardTitle>
          <span className="text-xs text-muted-foreground capitalize font-semibold">{activeTab}</span>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-2 space-y-2">
        <div className="flex gap-1">
          {panelTabs.map((tab) => (
            <Button
              key={tab.id}
              variant={activeTab === tab.id ? "default" : "ghost"}
              size="sm"
              onClick={() => onTabChange(tab.id)}
              className={
                activeTab === tab.id
                  ? "bg-[#3b82f6] hover:bg-[#2563eb] text-white text-xs h-7 px-2.5 font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary text-xs h-7 px-2.5 font-semibold"
              }
            >
              {tab.label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground leading-tight font-medium">
          Master input, now-task guidance, and quick actions.
        </p>
      </CardContent>
    </Card>
  )
}
