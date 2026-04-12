"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
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
import {
  Download,
  MoreVertical,
  Palette,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react"

import { MutabilityGuardModal } from "@/components/dashboard/mutability-guard-modal"
import type {
  CalendarMutationResponse,
  CalendarSource,
  UserCalendar,
} from "@/types"

export interface Calendar {
  id: string
  recordId?: string
  name: string
  color: string
  isVisible: boolean
  isImmutable?: boolean
  source: "local" | "google" | "imported" | "task"
}

type GuardIntent = {
  name: string
  color: string
  source: Extract<CalendarSource, "local" | "imported">
}

const colorOptions = [
  "#bfdbfe",
  "#bbf7d0",
  "#fde68a",
  "#fed7aa",
  "#fbcfe8",
  "#c7d2fe",
  "#a7f3d0",
  "#fecdd3",
  "#ddd6fe",
  "#bae6fd",
]

const initialCalendars: Calendar[] = []

interface CalendarsSidebarProps {
  isOpen: boolean
  onClose: () => void
  calendars: Calendar[]
  onCalendarsChange: (calendars: Calendar[]) => void
  onSelectCalendar?: (calendarId: string | null) => void
  activeCalendarId?: string | null
}

function sortCalendars(calendars: Calendar[]) {
  return [...calendars].sort((left, right) => {
    if (left.source === "task" && right.source !== "task") {
      return -1
    }

    if (left.source !== "task" && right.source === "task") {
      return 1
    }

    return left.name.localeCompare(right.name)
  })
}

function toSidebarCalendar(calendar: UserCalendar): Calendar {
  const recordId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    calendar.id,
  )
    ? calendar.id
    : undefined

  return {
    id: calendar.calendarKey,
    recordId,
    name: calendar.name,
    color: calendar.color,
    isVisible: calendar.isVisible,
    isImmutable: calendar.isImmutable,
    source: calendar.source,
  }
}

function getApiErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const details = "details" in payload && typeof payload.details === "string" ? payload.details : null
    const error = "error" in payload && typeof payload.error === "string" ? payload.error : null

    return details || error || fallback
  }

  return fallback
}

export function CalendarsSidebar({
  isOpen,
  onClose,
  calendars,
  onCalendarsChange,
  onSelectCalendar,
  activeCalendarId,
}: CalendarsSidebarProps) {
  const [newCalendarDialogOpen, setNewCalendarDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [editingCalendar, setEditingCalendar] = useState<Calendar | null>(null)
  const [colorPickerOpen, setColorPickerOpen] = useState<string | null>(null)
  const [guardIntent, setGuardIntent] = useState<GuardIntent | null>(null)
  const [isMutating, setIsMutating] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")

  const [newCalendarName, setNewCalendarName] = useState("")
  const [newCalendarColor, setNewCalendarColor] = useState(colorOptions[0])
  const [importName, setImportName] = useState("")
  const [importUrl, setImportUrl] = useState("")
  const [importColor, setImportColor] = useState(colorOptions[4])

  const calendarMap = useMemo(
    () => new Map(calendars.map((calendar) => [calendar.id, calendar])),
    [calendars],
  )

  async function persistCalendarMutation(
    request: () => Promise<Response>,
    fallbackError: string,
  ) {
    setErrorMessage("")
    setIsMutating(true)

    try {
      const response = await request()
      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, fallbackError))
      }

      return payload
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : fallbackError)
      return null
    } finally {
      setIsMutating(false)
    }
  }

  const handleCreateCalendar = () => {
    if (!newCalendarName.trim()) {
      return
    }

    setGuardIntent({
      name: newCalendarName.trim(),
      color: newCalendarColor,
      source: "local",
    })
  }

  const handleImportCalendar = () => {
    const trimmedUrl = importUrl.trim()
    const trimmedName = importName.trim()

    if (!trimmedUrl) {
      setErrorMessage("Add a calendar URL or file path before importing.")
      return
    }

    setGuardIntent({
      name: trimmedName || "Imported Calendar",
      color: importColor,
      source: "imported",
    })
  }

  const handleConfirmGuard = async (isImmutable: boolean) => {
    if (!guardIntent) {
      return
    }

    const payload = (await persistCalendarMutation(
      () =>
        fetch("/api/calendars", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: guardIntent.name,
            color: guardIntent.color,
            source: guardIntent.source,
            isImmutable,
          }),
        }),
      "Failed to create calendar.",
    )) as CalendarMutationResponse | null

    if (!payload?.calendar) {
      return
    }

    onCalendarsChange(sortCalendars([...calendars, toSidebarCalendar(payload.calendar)]))
    setNewCalendarName("")
    setNewCalendarColor(colorOptions[0])
    setImportName("")
    setImportUrl("")
    setImportColor(colorOptions[4])
    setNewCalendarDialogOpen(false)
    setImportDialogOpen(false)
    setGuardIntent(null)
  }

  const handleToggleVisibility = async (calendarId: string) => {
    const calendar = calendarMap.get(calendarId)

    if (!calendar?.recordId) {
      return
    }

    const payload = (await persistCalendarMutation(
      () =>
        fetch(`/api/calendars/${calendar.recordId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            isVisible: !calendar.isVisible,
          }),
        }),
      "Failed to update calendar visibility.",
    )) as CalendarMutationResponse | null

    if (!payload?.calendar) {
      return
    }

    onCalendarsChange(
      sortCalendars(
        calendars.map((item) =>
          item.id === calendar.id ? toSidebarCalendar(payload.calendar) : item,
        ),
      ),
    )
  }

  const handleRenameCalendar = async () => {
    if (!editingCalendar?.recordId) {
      return
    }

    const payload = (await persistCalendarMutation(
      () =>
        fetch(`/api/calendars/${editingCalendar.recordId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: editingCalendar.name,
          }),
        }),
      "Failed to rename calendar.",
    )) as CalendarMutationResponse | null

    if (!payload?.calendar) {
      return
    }

    onCalendarsChange(
      sortCalendars(
        calendars.map((item) =>
          item.id === editingCalendar.id ? toSidebarCalendar(payload.calendar) : item,
        ),
      ),
    )
    setEditingCalendar(null)
  }

  const handleDeleteCalendar = async (calendarId: string) => {
    const calendar = calendarMap.get(calendarId)

    if (!calendar?.recordId) {
      return
    }

    const payload = await persistCalendarMutation(
      () =>
        fetch(`/api/calendars/${calendar.recordId}`, {
          method: "DELETE",
        }),
      "Failed to delete calendar.",
    )

    if (!payload) {
      return
    }

    onCalendarsChange(calendars.filter((item) => item.id !== calendar.id))
    if (activeCalendarId === calendar.id) {
      onSelectCalendar?.(null)
    }
  }

  const handleChangeColor = async (calendarId: string, color: string) => {
    const calendar = calendarMap.get(calendarId)

    if (!calendar?.recordId) {
      return
    }

    const payload = (await persistCalendarMutation(
      () =>
        fetch(`/api/calendars/${calendar.recordId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            color,
          }),
        }),
      "Failed to update calendar color.",
    )) as CalendarMutationResponse | null

    if (!payload?.calendar) {
      return
    }

    onCalendarsChange(
      sortCalendars(
        calendars.map((item) =>
          item.id === calendar.id ? toSidebarCalendar(payload.calendar) : item,
        ),
      ),
    )
    setColorPickerOpen(null)
  }

  const handleCalendarClick = (calendarId: string) => {
    onSelectCalendar?.(activeCalendarId === calendarId ? null : calendarId)
  }

  if (!isOpen) {
    return null
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
      />

      <div className="fixed left-0 top-0 h-full w-72 bg-card/95 backdrop-blur-xl border-r border-border z-50 shadow-2xl transform transition-transform duration-300 ease-out animate-in slide-in-from-left">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-border p-4">
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

          <div className="flex-1 overflow-auto p-3 space-y-1">
            {errorMessage ? (
              <div className="rounded-xl border border-red-200/70 bg-red-100/40 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
                {errorMessage}
              </div>
            ) : null}

            {calendars.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-secondary/30 px-4 py-8 text-center">
                <p className="text-sm font-semibold text-foreground">No calendars yet</p>
                <p className="mt-1 text-xs font-medium text-muted-foreground">
                  Create a real calendar to start organizing your events.
                </p>
              </div>
            ) : (
              calendars.map((calendar) => (
                <div
                  key={calendar.id}
                  className={`relative flex items-center gap-3 rounded-lg p-2 transition-colors cursor-pointer ${
                    activeCalendarId === calendar.id ? "bg-secondary/80" : "hover:bg-secondary/50"
                  }`}
                  onClick={() => handleCalendarClick(calendar.id)}
                >
                  <Checkbox
                    checked={calendar.isVisible}
                    onCheckedChange={() => void handleToggleVisibility(calendar.id)}
                    onClick={(event) => event.stopPropagation()}
                    className="border-2"
                    style={{
                      borderColor: calendar.color,
                      backgroundColor: calendar.isVisible ? calendar.color : "transparent",
                    }}
                  />
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: calendar.color }}
                  />
                  <span className="flex-1 truncate text-sm font-medium text-foreground">
                    {calendar.name}
                  </span>
                  {calendar.source === "google" ? (
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      Google
                    </span>
                  ) : null}
                  {calendar.source === "task" ? (
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      TC
                    </span>
                  ) : null}
                  {calendar.source !== "task" ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 opacity-60 hover:opacity-100"
                          disabled={isMutating}
                        >
                          <MoreVertical className="w-3.5 h-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem onClick={() => setEditingCalendar(calendar)}>
                          <Pencil className="mr-2 h-3.5 w-3.5" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setColorPickerOpen(calendar.id)}>
                          <Palette className="mr-2 h-3.5 w-3.5" />
                          Change Color
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => void handleDeleteCalendar(calendar.id)}
                          className="text-red-500 focus:text-red-500"
                        >
                          <Trash2 className="mr-2 h-3.5 w-3.5" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}

                  {colorPickerOpen === calendar.id ? (
                    <div className="absolute right-16 z-50 rounded-lg border border-border bg-card p-2 shadow-lg">
                      <div className="grid grid-cols-5 gap-1">
                        {colorOptions.map((color) => (
                          <button
                            type="button"
                            key={color}
                            className="h-6 w-6 rounded-full border-2 border-transparent transition-colors hover:border-foreground/50"
                            style={{ backgroundColor: color }}
                            onClick={(event) => {
                              event.stopPropagation()
                              void handleChangeColor(calendar.id, color)
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>

          <div className="space-y-2 border-t border-border p-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNewCalendarDialogOpen(true)}
              className="w-full justify-start text-sm font-semibold"
            >
              <Plus className="mr-2 h-4 w-4" />
              New Calendar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportDialogOpen(true)}
              className="w-full justify-start text-sm font-semibold"
            >
              <Download className="mr-2 h-4 w-4" />
              Import (.ics)
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={newCalendarDialogOpen} onOpenChange={setNewCalendarDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="font-bold">Create New Calendar</DialogTitle>
            <DialogDescription className="font-medium">
              Pick a name and color. You&apos;ll choose the default mutability in the next step.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Name</label>
              <Input
                placeholder="Calendar name"
                value={newCalendarName}
                onChange={(event) => setNewCalendarName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Color</label>
              <div className="flex flex-wrap gap-2">
                {colorOptions.map((color) => (
                  <button
                    type="button"
                    key={color}
                    className={`h-8 w-8 rounded-full border-2 transition-colors ${
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
            <Button onClick={handleCreateCalendar} disabled={isMutating}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="font-bold">Import Calendar</DialogTitle>
            <DialogDescription className="font-medium">
              Add a name, source path, and color before choosing the default mutability guard.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Name</label>
              <Input
                placeholder="Imported calendar name"
                value={importName}
                onChange={(event) => setImportName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">URL or File Path</label>
              <Input
                placeholder="https://calendar.google.com/..."
                value={importUrl}
                onChange={(event) => setImportUrl(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Color</label>
              <div className="flex flex-wrap gap-2">
                {colorOptions.map((color) => (
                  <button
                    type="button"
                    key={color}
                    className={`h-8 w-8 rounded-full border-2 transition-colors ${
                      importColor === color ? "border-foreground" : "border-transparent"
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setImportColor(color)}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleImportCalendar} disabled={isMutating}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingCalendar)} onOpenChange={(open) => !open && setEditingCalendar(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="font-bold">Rename Calendar</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Name</label>
              <Input
                value={editingCalendar?.name || ""}
                onChange={(event) =>
                  setEditingCalendar((previous) =>
                    previous ? { ...previous, name: event.target.value } : null,
                  )
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCalendar(null)}>
              Cancel
            </Button>
            <Button onClick={() => void handleRenameCalendar()} disabled={isMutating}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MutabilityGuardModal
        open={guardIntent !== null}
        calendarName={guardIntent?.name ?? "New Calendar"}
        sourceLabel={guardIntent?.source === "imported" ? "imported" : "local"}
        onCancel={() => setGuardIntent(null)}
        onSave={handleConfirmGuard}
        isSaving={isMutating}
      />
    </>
  )
}

export { initialCalendars, sortCalendars, toSidebarCalendar }
