"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Sidebar, Moon, Sun, Shield, Check, Menu, Book } from "lucide-react"

interface DashboardHeaderProps {
  onTogglePanels?: () => void
  onToggleMobileMenu?: () => void
  onToggleTheme?: () => void
  onOpenCalendars?: () => void
  panelsHidden?: boolean
  isDarkMode?: boolean
}

export function DashboardHeader({ 
  onTogglePanels, 
  onToggleMobileMenu, 
  onToggleTheme,
  onOpenCalendars,
  panelsHidden,
  isDarkMode = true
}: DashboardHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-3">
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
        <h1 className="text-xl font-bold text-foreground">Today</h1>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded border border-border">
          <Shield className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground font-semibold">Safety</span>
          <Check className="w-4 h-4 text-[#4ade80]" />
          <span className="text-xs text-[#4ade80] font-semibold">Ready</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleTheme}
          className="text-muted-foreground hover:text-foreground hover:bg-secondary w-9 h-9"
        >
          {isDarkMode ? (
            <Moon className="w-4 h-4" />
          ) : (
            <Sun className="w-4 h-4" />
          )}
        </Button>
      </div>
    </div>
  )
}
