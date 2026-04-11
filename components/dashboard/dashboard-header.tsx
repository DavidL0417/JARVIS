"use client"

import { Button } from "@/components/ui/button"
import { Sidebar, Moon, Shield, Check, Menu } from "lucide-react"

interface DashboardHeaderProps {
  onTogglePanels?: () => void
  onToggleMobileMenu?: () => void
  panelsHidden?: boolean
}

export function DashboardHeader({ onTogglePanels, onToggleMobileMenu, panelsHidden }: DashboardHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-3">
        {/* Mobile menu button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleMobileMenu}
          className="md:hidden text-muted-foreground hover:text-foreground hover:bg-[#1f1f1f] p-2"
        >
          <Menu className="w-4 h-4" />
        </Button>
        {/* Desktop sidebar toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onTogglePanels}
          className="hidden md:flex text-muted-foreground hover:text-foreground hover:bg-[#1f1f1f] p-2"
        >
          <Sidebar className="w-4 h-4" />
        </Button>
        <h1 className="text-lg font-semibold text-foreground">Today</h1>
      </div>
      <div className="flex items-center gap-2">
        <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded border border-[#2a2a2a]">
          <Shield className="w-3 h-3 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">Safety</span>
          <Check className="w-3 h-3 text-[#4ade80]" />
          <span className="text-[10px] text-[#4ade80]">Ready</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground hover:bg-[#1f1f1f] w-8 h-8"
        >
          <Moon className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  )
}
