"use client"

import { Button } from "@/components/ui/button"
import { Sidebar, Moon, Shield, Check } from "lucide-react"

interface DashboardHeaderProps {
  onTogglePanels?: () => void
  panelsHidden?: boolean
}

export function DashboardHeader({ onTogglePanels, panelsHidden }: DashboardHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground hover:bg-[#1f1f1f] gap-2"
        >
          <Sidebar className="w-4 h-4" />
        </Button>
        <h1 className="text-2xl font-bold text-foreground">今日</h1>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#2a2a2a]">
          <Shield className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">安全</span>
          <Check className="w-4 h-4 text-[#4ade80]" />
          <span className="text-sm text-[#4ade80]">就绪</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground hover:bg-[#1f1f1f]"
        >
          <Moon className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}
