"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import type { ScheduleEvent } from "@/types"
import type { Calendar } from "./calendars-sidebar"

type ApprovalDraft = {
  priority: ScheduleEvent["priority"]
  isImmutable: boolean
}

interface CheckInSidebarProps {
  events: ScheduleEvent[]
  calendars: Calendar[]
  onEventApproved: (event: ScheduleEvent) => void
}

function formatEventWindow(event: ScheduleEvent) {
  return new Date(event.end).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function getMacaronCardClasses(calendarId: string | null, calendars: Calendar[]) {
  const calendar = calendars.find((item) => item.id === calendarId)
  const name = calendar?.name.toLowerCase() ?? ""

  if (name.includes("work")) {
    return "border-info/35 bg-info/10"
  }

  if (name.includes("class") || name.includes("academic")) {
    return "border-warning/35 bg-warning/10"
  }

  if (name.includes("social") || name.includes("personal")) {
    return "border-success/35 bg-success/10"
  }

  return "border-border bg-surface-subtle"
}

export function CheckInSidebar({
  events,
  calendars,
  onEventApproved,
}: CheckInSidebarProps) {
  const [drafts, setDrafts] = useState<Record<string, ApprovalDraft>>({})
  const [savingEventId, setSavingEventId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now())
    }, 60_000)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    setDrafts((currentDrafts) => {
      const nextDrafts: Record<string, ApprovalDraft> = {}

      for (const event of events) {
        nextDrafts[event.id] = currentDrafts[event.id] ?? {
          priority: event.priority,
          isImmutable: event.isImmutable,
        }
      }

      return nextDrafts
    })
  }, [events])

  const pendingEvents = useMemo(() => {
    return events.filter((event) => new Date(event.end).getTime() > now)
  }, [events, now])

  const handleSave = async (event: ScheduleEvent) => {
    const draft = drafts[event.id]

    if (!draft) {
      return
    }

    setErrorMessage(null)
    setSavingEventId(event.id)

    try {
      const response = await fetch("/api/checkin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventId: event.id,
          priority: draft.priority,
          isImmutable: draft.isImmutable,
        }),
      })

      const payload = (await response.json().catch(() => null)) as
        | { success?: boolean; event?: ScheduleEvent; error?: string; details?: string }
        | null

      if (!response.ok || !payload?.success || !payload.event) {
        throw new Error(payload?.details || payload?.error || "Failed to save check-in approval.")
      }

      onEventApproved(payload.event)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save check-in approval.")
    } finally {
      setSavingEventId(null)
    }
  }

  return (
    <Card className="border-info/35 bg-card shadow-sm">
      <CardHeader className="p-3 pb-1">
        <CardTitle className="text-sm font-bold text-foreground">Check-ins</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-3 pt-2">
        {errorMessage ? (
          <div className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
            {errorMessage}
          </div>
        ) : null}
        {pendingEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-md border border-success/35 bg-success/10 px-4 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-md bg-success text-success-foreground shadow-sm">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <p className="mt-3 text-sm font-semibold text-foreground">
              All check-ins are clear.
            </p>
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              The schedule has no pending approvals.
            </p>
          </div>
        ) : (
          pendingEvents.map((event) => {
            const draft = drafts[event.id] ?? {
              priority: event.priority,
              isImmutable: event.isImmutable,
            }
            const isSaving = savingEventId === event.id

            return (
              <div
                key={event.id}
                className={`animate-in slide-in-from-bottom-1 fade-in-50 rounded-md border p-3 shadow-sm transition-all duration-200 ease-out ${getMacaronCardClasses(
                  event.calendarId,
                  calendars,
                )}`}
              >
                <div className="grid gap-3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{event.title}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline">{formatEventWindow(event)}</Badge>
                      <Badge variant="outline">{event.source}</Badge>
                    </div>
                  </div>

                  <label className="space-y-1 text-xs font-semibold text-muted-foreground">
                    <span>Priority</span>
                    <select
                      value={draft.priority}
                      onChange={(nextEvent) =>
                        setDrafts((currentDrafts) => ({
                          ...currentDrafts,
                          [event.id]: {
                            ...draft,
                            priority: nextEvent.target.value as ScheduleEvent["priority"],
                          },
                        }))
                      }
                      className="h-9 w-full rounded-md border border-input bg-background/90 px-2 text-sm text-foreground"
                    >
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </label>

                  <div className="space-y-1 text-xs font-semibold text-muted-foreground">
                    <span>Mutable</span>
                    <div className="flex h-9 items-center justify-between rounded-md border border-input bg-background/90 px-3">
                      <span className="text-sm text-foreground">
                        {draft.isImmutable ? "No" : "Yes"}
                      </span>
                      <Switch
                        checked={!draft.isImmutable}
                        onCheckedChange={(checked) =>
                          setDrafts((currentDrafts) => ({
                            ...currentDrafts,
                            [event.id]: {
                              ...draft,
                              isImmutable: !checked,
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => void handleSave(event)}
                    disabled={isSaving}
                    className="bg-success text-success-foreground hover:bg-success/90"
                  >
                    {isSaving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                    Save
                  </Button>
                </div>
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}
