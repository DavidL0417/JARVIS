"use client"

import { useMemo, useState } from "react"
import { CalendarClock, CalendarPlus, Check, Loader2 } from "lucide-react"

import { RailSheet } from "@/components/dashboard/rail-sheet"
import type { SuggestedDeadlineItem } from "@/lib/needs-you"
import type { Task } from "@/types"

function formatDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
}

/**
 * The deliberate, batch counterpart to the single rail nudge: a review/triage
 * surface for inferred deadlines, reachable from the rail and the task manager
 * (not a top-level screen). Shows what JARVIS proposed (with its reasoning, so
 * the inference is legible) and the undated tasks it is still watching. Scope is
 * review only — no second schedule, no deadline database.
 */
export function DeadlinesReviewDrawer({
  isOpen,
  onClose,
  suggestions,
  tasks,
  onAcceptDeadline,
  onKeepUndated,
}: {
  isOpen: boolean
  onClose: () => void
  suggestions: SuggestedDeadlineItem[]
  tasks: Task[]
  onAcceptDeadline: (taskId: string) => Promise<void> | void
  onKeepUndated: (taskId: string) => Promise<void> | void
}) {
  const [pending, setPending] = useState<Record<string, boolean>>({})

  // Undated tasks with no live suggestion and not kept-undated: the ones JARVIS
  // is watching but has found no concrete anchor for yet.
  const watching = useMemo(() => {
    const suggestedIds = new Set(suggestions.map((suggestion) => suggestion.taskId))
    return tasks.filter(
      (task) =>
        task.status !== "completed" &&
        task.status !== "missed" &&
        !task.deadline &&
        !task.inferredDeadline &&
        !task.inferredDeadlineDismissed &&
        !suggestedIds.has(task.id),
    )
  }, [suggestions, tasks])

  const run = async (taskId: string, action: "accept" | "keep") => {
    setPending((prev) => ({ ...prev, [taskId]: true }))
    try {
      if (action === "accept") {
        await onAcceptDeadline(taskId)
      } else {
        await onKeepUndated(taskId)
      }
    } finally {
      setPending((prev) => {
        const next = { ...prev }
        delete next[taskId]
        return next
      })
    }
  }

  const acceptAll = async () => {
    for (const suggestion of suggestions) {
      await run(suggestion.taskId, "accept")
    }
  }

  const anyPending = Object.keys(pending).length > 0

  return (
    <RailSheet isOpen={isOpen} onClose={onClose} title="Deadlines" width="narrow">
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-3 border-b border-rule pb-5">
          <div className="flex h-7 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="eyebrow truncate">Suggested</h3>
              <span className="num text-[11px] font-medium text-muted-foreground">{suggestions.length}</span>
            </div>
            {suggestions.length > 1 ? (
              <button
                type="button"
                onClick={() => void acceptAll()}
                disabled={anyPending}
                className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-copper/50 bg-copper-soft px-2 text-[11px] font-medium uppercase text-copper transition-colors hover:bg-copper-soft/70 disabled:opacity-50"
              >
                <Check className="h-3 w-3" aria-hidden="true" />
                Set all
              </button>
            ) : null}
          </div>

          {suggestions.length === 0 ? (
            <p className="text-[12px] leading-5 text-muted-foreground">
              No suggestions right now. JARVIS proposes a deadline only when a dated anchor — a trip, an event, a
              dependency — makes one follow.
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {suggestions.map((suggestion) => {
                const isPending = Boolean(pending[suggestion.taskId])

                return (
                  <li key={suggestion.taskId} className="flex flex-col gap-1.5 border-b border-rule/50 pb-2.5 last:border-b-0 last:pb-0">
                    <p className="text-[13px] font-medium leading-5 text-foreground">{suggestion.title}</p>
                    <p className="inline-flex items-center gap-1.5 text-[11.5px] text-copper">
                      <CalendarClock className="h-3 w-3" aria-hidden="true" />
                      <span className="num">{formatDate(suggestion.suggestedDeadline)}</span>
                    </p>
                    <p className="text-[11.5px] leading-4 text-muted-foreground">{suggestion.reason}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void run(suggestion.taskId, "accept")}
                        disabled={isPending}
                        className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-copper/50 bg-copper-soft px-2 text-[11px] font-medium uppercase text-copper transition-colors hover:bg-copper-soft/70 disabled:opacity-50"
                      >
                        {isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                        ) : (
                          <CalendarPlus className="h-3 w-3" aria-hidden="true" />
                        )}
                        Set deadline
                      </button>
                      <button
                        type="button"
                        onClick={() => void run(suggestion.taskId, "keep")}
                        disabled={isPending}
                        className="inline-flex h-7 items-center rounded-sm border border-rule px-2 text-[11px] uppercase text-muted-foreground transition-colors hover:border-rule-strong hover:text-foreground disabled:opacity-50"
                      >
                        Keep undated
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {watching.length > 0 ? (
          <section className="flex flex-col gap-3">
            <div className="flex h-7 items-center gap-2">
              <h3 className="eyebrow truncate">Undated · watching</h3>
              <span className="num text-[11px] font-medium text-muted-foreground">{watching.length}</span>
            </div>
            <p className="text-[11px] leading-4 text-muted-foreground">
              No anchor found yet — JARVIS will suggest a deadline if a trip, event, or dependency makes one follow.
            </p>
            <ul className="flex flex-col gap-1.5">
              {watching.map((task) => (
                <li key={task.id} className="text-[12px] leading-5 text-foreground/90">
                  {task.title}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </RailSheet>
  )
}
