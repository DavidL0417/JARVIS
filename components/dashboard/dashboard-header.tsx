"use client"

import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Sidebar, Shield, Check, Menu, Book } from "lucide-react"

interface DashboardHeaderProps {
  onTogglePanels?: () => void
  onToggleMobileMenu?: () => void
  onOpenCalendars?: () => void
  panelsHidden?: boolean
  authControls?: ReactNode
}

export function DashboardHeader({ 
  onTogglePanels, 
  onToggleMobileMenu, 
  onOpenCalendars,
  panelsHidden,
  authControls,
}: DashboardHeaderProps) {
  return (
    <div className="mb-3 rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(18,18,25,0.92),rgba(28,31,45,0.72))] px-4 py-3 shadow-[0_18px_50px_rgba(0,0,0,0.28)] backdrop-blur-xl">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
        {/* Mobile menu button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleMobileMenu}
          className="md:hidden text-muted-foreground hover:text-foreground hover:bg-secondary p-2"
        >
          <Menu className="w-5 h-5" />
        </Button>
        {/* Desktop sidebar toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onTogglePanels}
          className="hidden md:flex text-muted-foreground hover:text-foreground hover:bg-secondary p-2"
        >
          <Sidebar className="w-5 h-5" />
        </Button>
        {/* Book icon for calendars sidebar */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenCalendars}
          className="text-muted-foreground hover:text-foreground hover:bg-secondary p-2"
          title="Open Calendars"
        >
          <Book className="w-5 h-5" />
        </Button>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-muted-foreground">
              JARVIS Command Deck
            </p>
            <h1 className="text-xl font-bold text-foreground">Today</h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {authControls}
          <div className="hidden items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 shadow-sm sm:flex">
            <Shield className="h-4 w-4 text-emerald-300" />
            <span className="text-xs font-semibold text-emerald-100">Safety</span>
            <Check className="h-4 w-4 text-emerald-300" />
            <span className="text-xs font-semibold text-emerald-200">
              {panelsHidden ? "Schedule focus" : "Ready"}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
