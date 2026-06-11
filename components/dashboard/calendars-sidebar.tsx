"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Check,
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
  source: "local" | "google" | "caldav" | "imported" | "task"
}

type GuardIntent = {
  name: string
  color: string
  source: Extract<CalendarSource, "local" | "imported">
}

const colorOptions = [
  "#c98a5b",
  "#7ea69a",
  "#a3956d",
  "#a07286",
  "#7e8aa3",
  "#9b8ea3",
  "#8aa093",
  "#b07a6d",
  "#7a8a8a",
  "#9ea073",
]

const initialCalendars: Calendar[] = []
const CALENDAR_GROUP_ORDER = [
  "caldav",
  "google",
  "task",
  "local",
  "imported",
] satisfies Calendar["source"][]

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
    const leftGroup = CALENDAR_GROUP_ORDER.indexOf(left.source)
    const rightGroup = CALENDAR_GROUP_ORDER.indexOf(right.source)

    if (leftGroup !== rightGroup) {
      return leftGroup - rightGroup
    }

    return left.name.localeCompare(right.name)
  })
}

function getCalendarGroupLabel(source: Calendar["source"]) {
  if (source === "google") return "Google"
  if (source === "caldav") return "Apple Calendar"
  if (source === "task") return "JARVIS"
  if (source === "imported") return "Imported"
  return "Local"
}

function isRemoteCalendar(calendar: Calendar) {
  return calendar.source === "google" || calendar.source === "caldav"
}

function getCalendarGroupOrder(group: string) {
  const source = CALENDAR_GROUP_ORDER.find((item) => getCalendarGroupLabel(item) === group)
  return source ? CALENDAR_GROUP_ORDER.indexOf(source) : CALENDAR_GROUP_ORDER.length
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
  const calendarGroups = useMemo(() => {
    const groups = new Map<string, Calendar[]>()

    for (const calendar of calendars) {
      const group = getCalendarGroupLabel(calendar.source)
      groups.set(group, [...(groups.get(group) ?? []), calendar])
    }

    return Array.from(groups.entries()).sort(
      ([left], [right]) => getCalendarGroupOrder(left) - getCalendarGroupOrder(right),
    )
  }, [calendars])

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

  const handleCalendarRowClick = (calendarId: string) => {
    if (onSelectCalendar) {
      handleCalendarClick(calendarId)
      return
    }

    void handleToggleVisibility(calendarId)
  }

  if (!isOpen) {
    return null
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-background/60 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <aside
        className="fixed left-0 top-0 z-50 h-full w-80 max-w-[calc(100vw-1rem)] border-r border-rule bg-background animate-in slide-in-from-left duration-200"
        aria-label="Calendars"
      >
        <div className="flex h-full flex-col">
          <header className="flex h-12 items-center justify-between border-b border-rule px-4">
            <h2 className="eyebrow">Calendars</h2>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[11px]">Close</TooltipContent>
            </Tooltip>
          </header>

          <div className="flex-1 overflow-auto px-2 py-2">
            {errorMessage ? (
              <p className="mx-2 mb-2 text-[11px] text-destructive">{errorMessage}</p>
            ) : null}

            {calendars.length === 0 ? (
              <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                No calendars.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {calendarGroups.map(([group, groupCalendars]) => (
                  <div key={group}>
                    <h3 className="px-3 pb-1.5 pt-3 text-[12px] font-semibold text-muted-foreground">
                      {group}
                    </h3>
                    <ul className="flex flex-col gap-0.5">
                      {groupCalendars.map((calendar) => {
                        const active = activeCalendarId === calendar.id
                        const remote = isRemoteCalendar(calendar)

                        return (
                          <li
                            key={calendar.id}
                            className={`group relative flex min-h-10 items-center gap-2 rounded-sm px-2 py-1.5 transition-colors ${
                              active ? "bg-accent" : "hover:bg-accent/45"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                void handleToggleVisibility(calendar.id)
                              }}
                              aria-label={
                                calendar.isVisible ? `Hide ${calendar.name}` : `Show ${calendar.name}`
                              }
                              aria-pressed={calendar.isVisible}
                              disabled={isMutating || !calendar.recordId}
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border text-background transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-60"
                              style={{
                                backgroundColor: calendar.isVisible ? calendar.color : "transparent",
                                borderColor: calendar.isVisible ? calendar.color : "var(--muted-foreground)",
                              }}
                            >
                              {calendar.isVisible ? (
                                <Check className="h-3.5 w-3.5" strokeWidth={3} />
                              ) : null}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCalendarRowClick(calendar.id)}
                              className={`min-w-0 flex-1 truncate text-left text-[14px] font-medium ${
                                calendar.isVisible ? "text-foreground" : "text-muted-foreground"
                              }`}
                            >
                              {calendar.name}
                            </button>
                            {calendar.source !== "task" ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  asChild
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <button
                                    type="button"
                                    aria-label={`More for ${calendar.name}`}
                                    disabled={isMutating}
                                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 focus:opacity-100"
                                  >
                                    <MoreVertical className="h-3.5 w-3.5" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-40">
                                  {!remote ? (
                                    <DropdownMenuItem onClick={() => setEditingCalendar(calendar)}>
                                      <Pencil className="mr-2 h-3.5 w-3.5" />
                                      Rename
                                    </DropdownMenuItem>
                                  ) : null}
                                  <DropdownMenuItem onClick={() => setColorPickerOpen(calendar.id)}>
                                    <Palette className="mr-2 h-3.5 w-3.5" />
                                    Color
                                  </DropdownMenuItem>
                                  {!remote ? (
                                    <DropdownMenuItem
                                      onClick={() => void handleDeleteCalendar(calendar.id)}
                                      className="text-destructive focus:text-destructive"
                                    >
                                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                                      Delete
                                    </DropdownMenuItem>
                                  ) : null}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : null}

                            {colorPickerOpen === calendar.id ? (
                              <div className="absolute right-10 top-9 z-50 rounded-sm border border-rule bg-popover p-1.5 shadow-lg">
                                <div className="grid grid-cols-5 gap-1">
                                  {colorOptions.map((color) => (
                                    <button
                                      type="button"
                                      key={color}
                                      aria-label={`Color ${color}`}
                                      className="h-5 w-5 rounded-sm border border-transparent transition-colors hover:border-foreground/40"
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
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

          <footer className="flex items-center gap-1 border-t border-rule px-2 py-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setNewCalendarDialogOpen(true)}
                  aria-label="New calendar"
                  className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm border border-rule text-[11px] text-foreground hover:bg-accent"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span className="num uppercase text-muted-foreground">New</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-[11px]">New calendar</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setImportDialogOpen(true)}
                  aria-label="Import .ics"
                  className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm border border-rule text-[11px] text-foreground hover:bg-accent"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span className="num uppercase text-muted-foreground">ICS</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-[11px]">Import .ics</TooltipContent>
            </Tooltip>
          </footer>
        </div>
      </aside>

      <Dialog open={newCalendarDialogOpen} onOpenChange={setNewCalendarDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">New calendar</DialogTitle>
            <DialogDescription className="text-[12px]">
              Name and color. Mutability comes next.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="eyebrow">Name</label>
              <Input
                placeholder="Calendar name"
                value={newCalendarName}
                onChange={(event) => setNewCalendarName(event.target.value)}
                className="h-8 text-[13px]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="eyebrow">Color</label>
              <div className="flex flex-wrap gap-1.5">
                {colorOptions.map((color) => (
                  <button
                    type="button"
                    key={color}
                    aria-label={`Color ${color}`}
                    className={`h-7 w-7 rounded-sm border transition-colors ${
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
            <Button variant="outline" size="sm" onClick={() => setNewCalendarDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreateCalendar} disabled={isMutating} className="bg-copper text-primary-foreground hover:opacity-90">
              <Check className="mr-1 h-3.5 w-3.5" />
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">Import .ics</DialogTitle>
            <DialogDescription className="text-[12px]">
              Source URL or path, then mutability.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="eyebrow">Name</label>
              <Input
                placeholder="Imported calendar"
                value={importName}
                onChange={(event) => setImportName(event.target.value)}
                className="h-8 text-[13px]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="eyebrow">URL or path</label>
              <Input
                placeholder="https://calendar.google.com/..."
                value={importUrl}
                onChange={(event) => setImportUrl(event.target.value)}
                className="num h-8 text-[12px]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="eyebrow">Color</label>
              <div className="flex flex-wrap gap-1.5">
                {colorOptions.map((color) => (
                  <button
                    type="button"
                    key={color}
                    aria-label={`Color ${color}`}
                    className={`h-7 w-7 rounded-sm border transition-colors ${
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
            <Button variant="outline" size="sm" onClick={() => setImportDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleImportCalendar} disabled={isMutating} className="bg-copper text-primary-foreground hover:opacity-90">
              <Check className="mr-1 h-3.5 w-3.5" />
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingCalendar)} onOpenChange={(open) => !open && setEditingCalendar(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">Rename</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <label className="eyebrow">Name</label>
            <Input
              value={editingCalendar?.name || ""}
              onChange={(event) =>
                setEditingCalendar((previous) =>
                  previous ? { ...previous, name: event.target.value } : null,
                )
              }
              className="h-8 text-[13px]"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditingCalendar(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleRenameCalendar()} disabled={isMutating} className="bg-copper text-primary-foreground hover:opacity-90">
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
