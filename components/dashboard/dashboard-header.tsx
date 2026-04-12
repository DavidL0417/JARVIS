"use client"

import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Sidebar, Moon, Sun, Shield, Check, Menu, Book } from "lucide-react"

interface DashboardHeaderProps {
  onTogglePanels?: () => void
  onToggleMobileMenu?: () => void
  onToggleTheme?: () => void
  onOpenCalendars?: () => void
  panelsHidden?: boolean
  isDarkMode?: boolean
  authControls?: ReactNode
}

export function DashboardHeader({ 
  onTogglePanels, 
  onToggleMobileMenu, 
  onToggleTheme,
  onOpenCalendars,
  panelsHidden,
  isDarkMode = true,
  authControls,
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
        {authControls}
        <div className="hidden items-center gap-2 rounded-full border border-emerald-200/70 bg-emerald-100/50 px-3 py-1.5 shadow-sm sm:flex dark:border-emerald-900/60 dark:bg-emerald-950/30">
          <Shield className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
          <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-100">Safety</span>
          <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-200">Ready</span>
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
