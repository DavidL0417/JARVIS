"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Plus, MoreVertical, Download, Pencil, Trash2, Palette, X } from "lucide-react"
import { INITIAL_SIDEBAR_CALENDAR_PRESETS } from "@/lib/calendar-config"

// Calendar interface for multi-calendar management
export interface Calendar {
  id: string
  name: string
  color: string
  isVisible: boolean
  source: "local" | "google" | "imported"
}

// API Hook: Replace mockCalendars with useCalendars() hook
// Example: const { data: calendars, mutate } = useSWR('/api/calendars', fetcher)
const initialCalendars: Calendar[] = INITIAL_SIDEBAR_CALENDAR_PRESETS.map((calendar) => ({
  id: calendar.id,
  name: calendar.name,
  color: calendar.color,
  isVisible: calendar.isVisibleByDefault,
  source: calendar.source,
}))

const colorOptions = [
  "#3b82f6", "#4ade80", "#fde047", "#fb923c", "#c084fc", 
  "#22d3ee", "#f87171", "#a78bfa", "#f472b6", "#34d399"
]

interface CalendarsSidebarProps {
  isOpen: boolean
  onClose: () => void
  calendars: Calendar[]
  onCalendarsChange: (calendars: Calendar[]) => void
  onSelectCalendar?: (calendarId: string | null) => void
  activeCalendarId?: string | null
}

export function CalendarsSidebar({ 
  isOpen, 
  onClose, 
  calendars, 
  onCalendarsChange,
  onSelectCalendar,
  activeCalendarId
}: CalendarsSidebarProps) {
  const [newCalendarDialogOpen, setNewCalendarDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [editingCalendar, setEditingCalendar] = useState<Calendar | null>(null)
  const [colorPickerOpen, setColorPickerOpen] = useState<string | null>(null)
  
  // New calendar form state
  const [newCalendarName, setNewCalendarName] = useState("")
  const [newCalendarColor, setNewCalendarColor] = useState("#3b82f6")
  const [importUrl, setImportUrl] = useState("")

  // API Hook: Replace with createCalendar mutation
  const handleCreateCalendar = () => {
    if (!newCalendarName.trim()) return
    const newCalendar: Calendar = {
      id: `cal-${Date.now()}`,
      name: newCalendarName.trim(),
      color: newCalendarColor,
      isVisible: true,
      source: "local",
    }
    onCalendarsChange([...calendars, newCalendar])
    setNewCalendarName("")
    setNewCalendarColor("#3b82f6")
    setNewCalendarDialogOpen(false)
  }

  // API Hook: Replace with importCalendar mutation
  const handleImportCalendar = () => {
    if (!importUrl.trim()) return
    // In real implementation, this would parse the .ics file
    const importedCalendar: Calendar = {
      id: `cal-${Date.now()}`,
      name: `Imported Calendar`,
      color: "#c084fc",
      isVisible: true,
      source: "imported",
    }
    onCalendarsChange([...calendars, importedCalendar])
    setImportUrl("")
    setImportDialogOpen(false)
  }

  // API Hook: Replace with updateCalendar mutation
  const handleToggleVisibility = (calendarId: string) => {
    const updated = calendars.map(cal => 
      cal.id === calendarId ? { ...cal, isVisible: !cal.isVisible } : cal
    )
    onCalendarsChange(updated)
  }

  // API Hook: Replace with updateCalendar mutation
  const handleRenameCalendar = () => {
    if (!editingCalendar) return
    const updated = calendars.map(cal => 
      cal.id === editingCalendar.id ? editingCalendar : cal
    )
    onCalendarsChange(updated)
    setEditingCalendar(null)
  }

  // API Hook: Replace with deleteCalendar mutation
  const handleDeleteCalendar = (calendarId: string) => {
    const updated = calendars.filter(cal => cal.id !== calendarId)
    onCalendarsChange(updated)
    if (activeCalendarId === calendarId) {
      onSelectCalendar?.(null)
    }
  }

  // API Hook: Replace with updateCalendar mutation
  const handleChangeColor = (calendarId: string, color: string) => {
    const updated = calendars.map(cal => 
      cal.id === calendarId ? { ...cal, color } : cal
    )
    onCalendarsChange(updated)
    setColorPickerOpen(null)
  }

  const handleCalendarClick = (calendarId: string) => {
    if (onSelectCalendar) {
      onSelectCalendar(activeCalendarId === calendarId ? null : calendarId)
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
      />
      
      {/* Sidebar */}
      <div className="fixed left-0 top-0 h-full w-72 bg-card/95 backdrop-blur-xl border-r border-border z-50 shadow-2xl transform transition-transform duration-300 ease-out animate-in slide-in-from-left">
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h2 className="text-base font-bold text-foreground">Calendars</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground h-8 w-8 p-0"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Calendar List */}
          <div className="flex-1 overflow-auto p-3 space-y-1">
            {calendars.map((calendar) => (
              <div 
                key={calendar.id} 
                className={`flex items-center gap-3 p-2 rounded-lg transition-colors cursor-pointer ${
                  activeCalendarId === calendar.id 
                    ? "bg-secondary/80" 
                    : "hover:bg-secondary/50"
                }`}
                onClick={() => handleCalendarClick(calendar.id)}
              >
                <Checkbox
                  checked={calendar.isVisible}
                  onCheckedChange={() => handleToggleVisibility(calendar.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="border-2"
                  style={{ borderColor: calendar.color, backgroundColor: calendar.isVisible ? calendar.color : "transparent" }}
                />
                <div 
                  className="w-3 h-3 rounded-full flex-shrink-0" 
                  style={{ backgroundColor: calendar.color }}
                />
                <span className="flex-1 text-sm font-medium text-foreground truncate">
                  {calendar.name}
                </span>
                {calendar.source === "google" && (
                  <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded font-medium">
                    Google
                  </span>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 opacity-60 hover:opacity-100">
                      <MoreVertical className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onClick={() => setEditingCalendar(calendar)}>
                      <Pencil className="w-3.5 h-3.5 mr-2" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setColorPickerOpen(calendar.id)}>
                      <Palette className="w-3.5 h-3.5 mr-2" />
                      Change Color
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      onClick={() => handleDeleteCalendar(calendar.id)}
                      className="text-red-500 focus:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Color Picker Popover */}
                {colorPickerOpen === calendar.id && (
                  <div className="absolute right-16 bg-card border border-border rounded-lg p-2 shadow-lg z-50">
                    <div className="grid grid-cols-5 gap-1">
                      {colorOptions.map((color) => (
                        <button
                          key={color}
                          className="w-6 h-6 rounded-full border-2 border-transparent hover:border-foreground/50 transition-colors"
                          style={{ backgroundColor: color }}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleChangeColor(calendar.id, color)
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="p-3 border-t border-border space-y-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNewCalendarDialogOpen(true)}
              className="w-full justify-start text-sm font-semibold"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Calendar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportDialogOpen(true)}
              className="w-full justify-start text-sm font-semibold"
            >
              <Download className="w-4 h-4 mr-2" />
              Import (.ics)
            </Button>
          </div>
        </div>
      </div>

      {/* New Calendar Dialog */}
      <Dialog open={newCalendarDialogOpen} onOpenChange={setNewCalendarDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="font-bold">Create New Calendar</DialogTitle>
            <DialogDescription className="font-medium">
              Add a new calendar to organize your events.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Name</label>
              <Input
                placeholder="Calendar name"
                value={newCalendarName}
                onChange={(e) => setNewCalendarName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Color</label>
              <div className="flex gap-2">
                {colorOptions.map((color) => (
                  <button
                    key={color}
                    className={`w-8 h-8 rounded-full border-2 transition-colors ${
                      newCalendarColor === color ? "border-foreground" : "border-transparent"
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewCalendarColor(color)}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewCalendarDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateCalendar}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="font-bold">Import Calendar</DialogTitle>
            <DialogDescription className="font-medium">
              Import events from an .ics file or external URL.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">URL or File Path</label>
              <Input
                placeholder="https://calendar.google.com/..."
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleImportCalendar}>Import</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog open={!!editingCalendar} onOpenChange={(open) => !open && setEditingCalendar(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="font-bold">Rename Calendar</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Name</label>
              <Input
                value={editingCalendar?.name || ""}
                onChange={(e) => setEditingCalendar(prev => prev ? { ...prev, name: e.target.value } : null)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCalendar(null)}>
              Cancel
            </Button>
            <Button onClick={handleRenameCalendar}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// Export initial calendars for use in page
export { initialCalendars }
