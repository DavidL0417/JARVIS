"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, Lock, LockOpen, Loader2 } from "lucide-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
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

const PRIORITIES: ScheduleEvent["priority"][] = ["high", "medium", "low"]

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
        throw new Error(payload?.details || payload?.error || "Failed to save check-in.")
      }

      onEventApproved(payload.event)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save check-in.")
    } finally {
      setSavingEventId(null)
    }
  }

  if (pendingEvents.length === 0) {
    return null
  }

  return (
    <section className="flex flex-col">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="eyebrow">Check-in</h2>
          <span className="num text-[10px] uppercase tracking-[0.12em] copper">
            {pendingEvents.length}
          </span>
        </div>
      </header>

      {errorMessage ? (
        <p className="mb-2 text-[11px] text-destructive">{errorMessage}</p>
      ) : null}

      <ul className="border-y border-rule">
        {pendingEvents.map((event) => {
          const draft = drafts[event.id] ?? {
            priority: event.priority,
            isImmutable: event.isImmutable,
          }
          const isSaving = savingEventId === event.id
          const calendarColor = calendars.find((c) => c.id === event.calendarId)?.color

          return (
            <li
              key={event.id}
              className="space-y-2 border-b border-rule px-1 py-2 last:border-b-0"
            >
              <div className="flex items-baseline gap-3">
                {calendarColor ? (
                  <span
                    className="mt-1 h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: calendarColor }}
                    aria-hidden="true"
                  />
                ) : (
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-copper" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-foreground">{event.title}</p>
                  <p className="num mt-0.5 text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">
                    Ends {formatEventWindow(event)} · {event.source}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pl-5">
                <div className="flex items-center gap-0.5 rounded-sm border border-rule p-0.5">
                  {PRIORITIES.map((priority) => {
                    const active = draft.priority === priority
                    return (
                      <button
                        key={priority}
                        type="button"
                        onClick={() =>
                          setDrafts((current) => ({
                            ...current,
                            [event.id]: { ...draft, priority },
                          }))
                        }
                        aria-pressed={active}
                        className={`num rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] transition-colors ${
                          active ? "bg-copper-soft text-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {priority.charAt(0)}
                      </button>
                    )
                  })}
                </div>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() =>
                        setDrafts((current) => ({
                          ...current,
                          [event.id]: { ...draft, isImmutable: !draft.isImmutable },
                        }))
                      }
                      aria-label={draft.isImmutable ? "Make mutable" : "Make immutable"}
                      aria-pressed={draft.isImmutable}
                      className={`flex h-6 w-6 items-center justify-center rounded-sm border border-rule transition-colors ${
                        draft.isImmutable ? "bg-copper-soft text-foreground" : "text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {draft.isImmutable ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-[11px]">
                    {draft.isImmutable ? "Pinned" : "Movable"}
                  </TooltipContent>
                </Tooltip>

                <button
                  type="button"
                  onClick={() => void handleSave(event)}
                  disabled={isSaving}
                  className="num ml-auto flex h-6 items-center gap-1 rounded-sm bg-copper px-2 text-[10px] uppercase tracking-[0.12em] text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {isSaving ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  Save
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
