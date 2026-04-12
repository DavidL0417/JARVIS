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
    <Card className="overflow-hidden border-white/10 bg-[linear-gradient(135deg,rgba(19,22,33,0.94),rgba(33,25,46,0.82))] shadow-[0_18px_44px_rgba(0,0,0,0.18)]">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold text-foreground">Panel Rail</CardTitle>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] text-muted-foreground capitalize font-semibold">
            {activeTab}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        <div className="grid grid-cols-2 gap-2">
          {panelTabs.map((tab) => (
            <Button
              key={tab.id}
              variant={activeTab === tab.id ? "default" : "ghost"}
              size="sm"
              onClick={() => onTabChange(tab.id)}
              className={
                activeTab === tab.id
                  ? "h-8 bg-gradient-to-r from-orange-300 via-rose-300 to-fuchsia-300 px-2.5 text-xs font-semibold text-slate-950 shadow-[0_10px_28px_rgba(251,146,60,0.24)] hover:from-orange-300 hover:via-rose-300 hover:to-fuchsia-300"
                  : "h-8 border border-white/10 bg-white/[0.03] px-2.5 text-xs font-semibold text-muted-foreground hover:border-white/18 hover:bg-white/[0.06] hover:text-foreground"
              }
            >
              {tab.label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground leading-tight font-medium">
          Switch between guidance, task operations, and recovery queues without losing the left-column flow.
        </p>
      </CardContent>
    </Card>
  )
}
