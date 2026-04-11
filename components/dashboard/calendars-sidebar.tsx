"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Palette,
  Download,
  Check,
  Globe,
  Monitor,
  Cloud,
} from "lucide-react"
import {
  useCalendarStore,
  CALENDAR_COLORS,
  type Calendar,
  type CalendarColor,
} from "@/lib/stores/calendar-store"

interface CalendarsSidebarProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function ColorPicker({
  selectedColor,
  onSelect,
}: {
  selectedColor: CalendarColor
  onSelect: (color: CalendarColor) => void
}) {
  return (
    <div className="grid grid-cols-4 gap-2 p-2">
      {CALENDAR_COLORS.map((color) => (
        <button
          key={color.value}
          onClick={() => onSelect(color.value)}
          className="relative w-8 h-8 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-card dark:focus:ring-offset-[#1a1a1a] focus:ring-ring"
          style={{ backgroundColor: color.value }}
          title={color.name}
        >
          {selectedColor === color.value && (
            <Check className="absolute inset-0 m-auto w-4 h-4 text-white drop-shadow-md" />
          )}
        </button>
      ))}
    </div>
  )
}

function CalendarSourceIcon({ source }: { source: Calendar["source"] }) {
  switch (source) {
    case "google":
      return <Globe className="w-3.5 h-3.5 text-muted-foreground" />
    case "icloud":
      return <Cloud className="w-3.5 h-3.5 text-muted-foreground" />
    case "imported":
      return <Download className="w-3.5 h-3.5 text-muted-foreground" />
    default:
      return <Monitor className="w-3.5 h-3.5 text-muted-foreground" />
  }
}

function CalendarItem({
  calendar,
  onSelect,
  isActive,
}: {
  calendar: Calendar
  onSelect: () => void
  isActive: boolean
}) {
  const { toggleCalendarVisibility, updateCalendar, deleteCalendar } = useCalendarStore()
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [colorPickerOpen, setColorPickerOpen] = useState(false)
  const [newName, setNewName] = useState(calendar.name)

  const handleRename = () => {
    if (newName.trim()) {
      updateCalendar(calendar.id, { name: newName.trim() })
      setRenameDialogOpen(false)
    }
  }

  return (
    <>
      <div
        className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer ${
          isActive
            ? "bg-secondary dark:bg-[#2a2a2a]"
            : "hover:bg-secondary/50 dark:hover:bg-[#1f1f1f]"
        }`}
        onClick={onSelect}
      >
        <Checkbox
          checked={calendar.visible}
          onCheckedChange={() => toggleCalendarVisibility(calendar.id)}
          onClick={(e) => e.stopPropagation()}
          className="border-border dark:border-[#3a3a3a] data-[state=checked]:border-transparent"
          style={{
            backgroundColor: calendar.visible ? calendar.color : "transparent",
            borderColor: calendar.visible ? calendar.color : undefined,
          }}
        />
        <div
          className="w-3 h-3 rounded-full shrink-0"
          style={{ backgroundColor: calendar.color }}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{calendar.name}</p>
        </div>
        <CalendarSourceIcon source={calendar.source} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="opacity-0 group-hover:opacity-100 h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-secondary dark:hover:bg-[#2a2a2a]"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-44 bg-card dark:bg-[#1a1a1a] border-border dark:border-[#2a2a2a]"
          >
            <DropdownMenuItem
              className="text-sm font-medium text-foreground hover:bg-secondary dark:hover:bg-[#2a2a2a] cursor-pointer"
              onClick={() => {
                setNewName(calendar.name)
                setRenameDialogOpen(true)
              }}
            >
              <Pencil className="w-4 h-4 mr-2" />
              Rename
            </DropdownMenuItem>
            <Popover open={colorPickerOpen} onOpenChange={setColorPickerOpen}>
              <PopoverTrigger asChild>
                <DropdownMenuItem
                  className="text-sm font-medium text-foreground hover:bg-secondary dark:hover:bg-[#2a2a2a] cursor-pointer"
                  onSelect={(e) => e.preventDefault()}
                >
                  <Palette className="w-4 h-4 mr-2" />
                  Change Color
                </DropdownMenuItem>
              </PopoverTrigger>
              <PopoverContent
                side="right"
                className="w-auto p-0 bg-card dark:bg-[#1a1a1a] border-border dark:border-[#2a2a2a]"
              >
                <ColorPicker
                  selectedColor={calendar.color}
                  onSelect={(color) => {
                    updateCalendar(calendar.id, { color })
                    setColorPickerOpen(false)
                  }}
                />
              </PopoverContent>
            </Popover>
            {!calendar.isDefault && (
              <>
                <DropdownMenuSeparator className="bg-border dark:bg-[#2a2a2a]" />
                <DropdownMenuItem
                  className="text-sm font-medium text-destructive hover:bg-secondary dark:hover:bg-[#2a2a2a] hover:text-destructive cursor-pointer"
                  onClick={() => deleteCalendar(calendar.id)}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-[400px] bg-card dark:bg-[#141414] border-border dark:border-[#2a2a2a]">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground">Rename Calendar</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Enter a new name for this calendar.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Calendar name"
            className="bg-background dark:bg-[#0a0a0a] border-border dark:border-[#2a2a2a] text-foreground placeholder:text-muted-foreground text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename()
            }}
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setRenameDialogOpen(false)}
              className="text-muted-foreground hover:text-foreground hover:bg-secondary dark:hover:bg-[#1f1f1f] font-semibold"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRename}
              className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function CalendarsSidebar({ open, onOpenChange }: CalendarsSidebarProps) {
  const { calendars, addCalendar, activeCalendarId, setActiveCalendar } = useCalendarStore()
  const [newCalendarDialogOpen, setNewCalendarDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [newCalendarName, setNewCalendarName] = useState("")
  const [newCalendarColor, setNewCalendarColor] = useState<CalendarColor>("#3b82f6")
  const [importUrl, setImportUrl] = useState("")

  const handleAddCalendar = () => {
    if (newCalendarName.trim()) {
      addCalendar(newCalendarName.trim(), newCalendarColor)
      setNewCalendarName("")
      setNewCalendarColor("#3b82f6")
      setNewCalendarDialogOpen(false)
    }
  }

  const handleImport = () => {
    if (importUrl.trim()) {
      // In a real app, this would parse the .ics file or external link
      addCalendar(`Imported Calendar`, "#22c55e", "imported")
      setImportUrl("")
      setImportDialogOpen(false)
    }
  }

  const localCalendars = calendars.filter((c) => c.source === "local")
  const importedCalendars = calendars.filter((c) => c.source !== "local")

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="left"
          className="w-[320px] sm:w-[360px] bg-background/95 dark:bg-[#0f0f0f]/95 backdrop-blur-xl border-border dark:border-[#2a2a2a] p-0"
        >
          <SheetHeader className="p-5 pb-3 border-b border-border dark:border-[#1f1f1f]">
            <SheetTitle className="text-foreground text-lg font-bold">
              Calendars
            </SheetTitle>
            <SheetDescription className="text-sm font-medium text-muted-foreground">
              Manage your calendars and visibility
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1 h-[calc(100vh-200px)]">
            <div className="p-4 space-y-5">
              {/* My Calendars Section */}
              <div>
                <div className="flex items-center justify-between px-1 mb-3">
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    My Calendars
                  </h3>
                  <span className="text-xs font-semibold text-muted-foreground">{localCalendars.length}</span>
                </div>
                <div className="space-y-1">
                  {localCalendars.map((calendar) => (
                    <CalendarItem
                      key={calendar.id}
                      calendar={calendar}
                      onSelect={() => setActiveCalendar(activeCalendarId === calendar.id ? null : calendar.id)}
                      isActive={activeCalendarId === calendar.id}
                    />
                  ))}
                </div>
              </div>

              {/* Imported/Synced Calendars Section */}
              {importedCalendars.length > 0 && (
                <div>
                  <div className="flex items-center justify-between px-1 mb-3">
                    <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      Synced & Imported
                    </h3>
                    <span className="text-xs font-semibold text-muted-foreground">{importedCalendars.length}</span>
                  </div>
                  <div className="space-y-1">
                    {importedCalendars.map((calendar) => (
                      <CalendarItem
                        key={calendar.id}
                        calendar={calendar}
                        onSelect={() => setActiveCalendar(activeCalendarId === calendar.id ? null : calendar.id)}
                        isActive={activeCalendarId === calendar.id}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Bottom Actions */}
          <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-border dark:border-[#1f1f1f] bg-background/95 dark:bg-[#0f0f0f]/95 backdrop-blur-xl space-y-2">
            <Button
              onClick={() => setNewCalendarDialogOpen(true)}
              className="w-full justify-start gap-2 bg-card dark:bg-[#1a1a1a] hover:bg-secondary dark:hover:bg-[#2a2a2a] text-foreground border border-border dark:border-[#2a2a2a] text-sm font-semibold h-10"
            >
              <Plus className="w-4 h-4" />
              New Calendar
            </Button>
            <Button
              variant="ghost"
              onClick={() => setImportDialogOpen(true)}
              className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground hover:bg-secondary dark:hover:bg-[#1f1f1f] text-sm font-semibold h-10"
            >
              <Download className="w-4 h-4" />
              Import Calendar
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* New Calendar Dialog */}
      <Dialog open={newCalendarDialogOpen} onOpenChange={setNewCalendarDialogOpen}>
        <DialogContent className="sm:max-w-[440px] bg-card dark:bg-[#141414] border-border dark:border-[#2a2a2a]">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground">Create New Calendar</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Add a new calendar to organize your events and tasks.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-3">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Calendar Name</label>
              <Input
                value={newCalendarName}
                onChange={(e) => setNewCalendarName(e.target.value)}
                placeholder="e.g., Work, Personal, Fitness"
                className="bg-background dark:bg-[#0a0a0a] border-border dark:border-[#2a2a2a] text-foreground placeholder:text-muted-foreground text-sm h-10"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Color</label>
              <ColorPicker selectedColor={newCalendarColor} onSelect={setNewCalendarColor} />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setNewCalendarDialogOpen(false)}
              className="text-muted-foreground hover:text-foreground hover:bg-secondary dark:hover:bg-[#1f1f1f] font-semibold"
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddCalendar}
              disabled={!newCalendarName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 font-semibold"
            >
              Create Calendar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-[440px] bg-card dark:bg-[#141414] border-border dark:border-[#2a2a2a]">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground">Import Calendar</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Import events from an .ics file or external calendar URL.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-3">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Calendar URL</label>
              <Input
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder="https://... or path to .ics file"
                className="bg-background dark:bg-[#0a0a0a] border-border dark:border-[#2a2a2a] text-foreground placeholder:text-muted-foreground text-sm h-10"
              />
              <p className="text-xs font-medium text-muted-foreground">
                Supports .ics files and webcal:// URLs
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setImportDialogOpen(false)}
              className="text-muted-foreground hover:text-foreground hover:bg-secondary dark:hover:bg-[#1f1f1f] font-semibold"
            >
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={!importUrl.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 font-semibold"
            >
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
