"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Sidebar, Moon, Sun, Shield, Check, Menu, BookOpen } from "lucide-react"
import { useCalendarStore } from "@/lib/stores/calendar-store"

interface DashboardHeaderProps {
  onTogglePanels?: () => void
  onToggleMobileMenu?: () => void
  onToggleCalendarSidebar?: () => void
  panelsHidden?: boolean
}

export function DashboardHeader({ onTogglePanels, onToggleMobileMenu, onToggleCalendarSidebar, panelsHidden }: DashboardHeaderProps) {
  const { theme, toggleTheme, setTheme } = useCalendarStore()

  // Initialize theme on mount
  useEffect(() => {
    // Check if user has a saved preference or system preference
    const savedTheme = typeof window !== "undefined" ? localStorage.getItem("theme") : null
    const systemPrefersDark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
    
    const initialTheme = savedTheme ? (savedTheme as "dark" | "light") : (systemPrefersDark ? "dark" : "light")
    setTheme(initialTheme)
    
    // Apply theme to document
    document.documentElement.classList.toggle("dark", initialTheme === "dark")
  }, [setTheme])

  // Handle theme toggle
  const handleThemeToggle = () => {
    toggleTheme()
    // Save preference
    const newTheme = theme === "dark" ? "light" : "dark"
    localStorage.setItem("theme", newTheme)
    document.documentElement.classList.toggle("dark", newTheme === "dark")
  }

  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-3">
        {/* Mobile menu button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleMobileMenu}
          className="md:hidden text-muted-foreground hover:text-foreground hover:bg-secondary/50 dark:hover:bg-[#1f1f1f] p-2"
        >
          <Menu className="w-5 h-5" />
        </Button>
        {/* Calendar sidebar toggle (Book icon) */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleCalendarSidebar}
          className="text-muted-foreground hover:text-foreground hover:bg-secondary/50 dark:hover:bg-[#1f1f1f] p-2"
          title="Manage Calendars"
        >
          <BookOpen className="w-5 h-5" />
        </Button>
        {/* Desktop sidebar toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onTogglePanels}
          className="hidden md:flex text-muted-foreground hover:text-foreground hover:bg-secondary/50 dark:hover:bg-[#1f1f1f] p-2"
        >
          <Sidebar className="w-5 h-5" />
        </Button>
        <h1 className="text-xl font-bold text-foreground">Today</h1>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border dark:border-[#2a2a2a] bg-card dark:bg-transparent">
          <Shield className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold text-muted-foreground">Safety</span>
          <Check className="w-4 h-4 text-emerald-500" />
          <span className="text-sm font-semibold text-emerald-500">Ready</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleThemeToggle}
          className="text-muted-foreground hover:text-foreground hover:bg-secondary/50 dark:hover:bg-[#1f1f1f] w-10 h-10"
          title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
        >
          {theme === "dark" ? (
            <Moon className="w-5 h-5" />
          ) : (
            <Sun className="w-5 h-5" />
          )}
        </Button>
      </div>
    </div>
  )
}
