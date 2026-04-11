"use client"

import { Button } from "@/components/ui/button"
import { Sidebar, Moon, Sun, Shield, Check, Menu } from "lucide-react"

interface DashboardHeaderProps {
  onTogglePanels?: () => void
  onToggleMobileMenu?: () => void
  onToggleTheme?: () => void
  panelsHidden?: boolean
  isDarkMode?: boolean
}

export function DashboardHeader({ 
  onTogglePanels, 
  onToggleMobileMenu, 
  onToggleTheme,
  panelsHidden,
  isDarkMode = true
}: DashboardHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-3">
        {/* Mobile menu button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleMobileMenu}
          className="md:hidden text-muted-foreground hover:text-foreground hover:bg-secondary p-2"
        >
          <Menu className="w-4 h-4" />
        </Button>
        {/* Desktop sidebar toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onTogglePanels}
          className="hidden md:flex text-muted-foreground hover:text-foreground hover:bg-secondary p-2"
        >
          <Sidebar className="w-4 h-4" />
        </Button>
        <h1 className="text-lg font-semibold text-foreground">Today</h1>
      </div>
      <div className="flex items-center gap-2">
        <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded border border-border">
          <Shield className="w-3 h-3 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">Safety</span>
          <Check className="w-3 h-3 text-[#4ade80]" />
          <span className="text-[10px] text-[#4ade80]">Ready</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleTheme}
          className="text-muted-foreground hover:text-foreground hover:bg-secondary w-8 h-8"
        >
          {isDarkMode ? (
            <Moon className="w-3.5 h-3.5" />
          ) : (
            <Sun className="w-3.5 h-3.5" />
          )}
        </Button>
      </div>
    </div>
  )
}
