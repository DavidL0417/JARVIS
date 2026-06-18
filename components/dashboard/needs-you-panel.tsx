"use client"

import { useEffect, useMemo, useState } from "react"
import { Archive, Clock3, Loader2, ShieldAlert, Sparkles, X } from "lucide-react"

import { DeadlinesReviewDrawer } from "@/components/dashboard/deadlines-review-drawer"
import { RailSection } from "@/components/dashboard/rail-section"
import { RiskArchiveDrawer } from "@/components/dashboard/risk-archive-drawer"
import { buildNeedsYou, type NeedsYouItem, type SuggestedDeadlineItem } from "@/lib/needs-you"
import { RISK_TYPE_CONFIG, type RiskActionConfig, type RiskType } from "@/lib/risk-types"
import type { DailyPlan, DashboardReentry, RiskDecision, Task } from "@/types"

const REENTRY_DISMISS_KEY = "jarvis-reentry-dismissed-at"

export interface NeedsYouHandlers {
  /** Targeted replan for a primary "fix" action. */
  onReplan: (command: string) => Promise<void> | void
  /** Full rebuild — used by "Retry sync" since a build force-refreshes sources. */
  onRebuild: () => Promise<void> | void
  onCompleteTask: (taskId: string) => Promise<void> | void
  onRestoreTask: (taskId: string) => Promise<void> | void
  onDecide: (input: {
    riskType: RiskType
    subjectKey: string
    taskId: string | null
    action: "snooze" | "dismiss"
  }) => Promise<void> | void
  onClearDecision: (input: { riskType: RiskType; subjectKey: string }) => Promise<void> | void
  /** Inferred-deadline suggestions (Workstream 2). */
  onAcceptDeadline: (taskId: string) => Promise<void> | void
  onKeepUndated: (taskId: string) => Promise<void> | void
}

function formatSuggestedDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
}

function severityTone(severity: NeedsYouItem["severity"]) {
  if (severity === "high") return "text-destructive"
  if (severity === "medium") return "text-copper"
  return "text-muted-foreground"
}

function replanCommand(item: NeedsYouItem): string {
  switch (item.riskType) {
    case "overdue":
      return `Reschedule overdue work — ${item.detail}`
    case "deadline_no_block":
      return `Find a work block before the deadline — ${item.detail}`
    case "unschedulable":
      return `Make room for the task the planner couldn't fit — ${item.detail}`
    case "overloaded_day":
      return `Spread out the overloaded day — ${item.detail}`
    case "compression":
      return `Spread work to ease the compressed week ahead — ${item.detail}`
    default:
      return `Re-plan around: ${item.detail}`
  }
}

function ReentryNote({ reentry }: { reentry: DashboardReentry }) {
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    const dismissedAt = window.localStorage.getItem(REENTRY_DISMISS_KEY)
    const stale = !dismissedAt || Date.now() - Number(dismissedAt) > 12 * 60 * 60 * 1000
    setDismissed(!stale)
  }, [])

  if (dismissed) {
    return null
  }

  const parts: string[] = []
  if (reentry.unconfirmedCount > 0) {
    parts.push(`${reentry.unconfirmedCount} planned block${reentry.unconfirmedCount === 1 ? "" : "s"} left unconfirmed`)
  }
  if (reentry.autoImportedCount > 0) {
    parts.push(`${reentry.autoImportedCount} item${reentry.autoImportedCount === 1 ? "" : "s"} auto-imported`)
  }
  if (reentry.passedDeadlines.length > 0) {
    parts.push(
      reentry.passedDeadlines.length === 1
        ? `"${reentry.passedDeadlines[0]}" deadline passed`
        : `${reentry.passedDeadlines.length} deadlines passed`,
    )
  }

  return (
    <div className="flex items-start gap-2 rounded-sm border border-rule/70 bg-secondary/20 px-2.5 py-2">
      <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-[11px] leading-4 text-muted-foreground">
        <span className="font-medium text-foreground">Away {reentry.gapDays} day{reentry.gapDays === 1 ? "" : "s"}.</span>{" "}
        {parts.length > 0
          ? `Nothing was lost — ${parts.join(" · ")}. Build today's plan when ready; it reconciles the rest.`
          : "Your schedule is reconciled and ready."}
      </p>
      <button
        type="button"
        onClick={() => {
          window.localStorage.setItem(REENTRY_DISMISS_KEY, String(Date.now()))
          setDismissed(true)
        }}
        aria-label="Dismiss away note"
        className="-mr-1 -mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  )
}

export function NeedsYouPanel({
  dailyPlan,
  tasks,
  riskDecisions,
  reentry,
  isPlanning,
  handlers,
}: {
  dailyPlan: DailyPlan | null
  tasks: Task[]
  riskDecisions: RiskDecision[]
  reentry: DashboardReentry | null
  isPlanning: boolean
  handlers: NeedsYouHandlers
}) {
  const [pendingKeys, setPendingKeys] = useState<Record<string, boolean>>({})
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [deadlinesOpen, setDeadlinesOpen] = useState(false)

  const { items, suggestions, archive } = useMemo(
    () =>
      buildNeedsYou({
        riskItems: dailyPlan?.riskItems ?? [],
        tasks,
        decisions: riskDecisions,
      }),
    [dailyPlan?.riskItems, tasks, riskDecisions],
  )

  const runSuggestionAction = async (
    suggestion: SuggestedDeadlineItem,
    action: "accept" | "keep",
  ) => {
    const key = `suggestion:${suggestion.taskId}`
    setPendingKeys((prev) => ({ ...prev, [key]: true }))
    try {
      if (action === "accept") {
        await handlers.onAcceptDeadline(suggestion.taskId)
      } else {
        await handlers.onKeepUndated(suggestion.taskId)
      }
    } finally {
      setPendingKeys((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
  }

  const runAction = async (item: NeedsYouItem, action: RiskActionConfig) => {
    setPendingKeys((prev) => ({ ...prev, [item.key]: true }))
    try {
      switch (action.kind) {
        case "replan":
          if (item.riskType === "source_failed") {
            await handlers.onRebuild()
          } else {
            await handlers.onReplan(replanCommand(item))
          }
          break
        case "complete":
          if (item.taskId) {
            await handlers.onCompleteTask(item.taskId)
          }
          break
        case "snooze":
          await handlers.onDecide({
            riskType: item.riskType,
            subjectKey: item.subjectKey,
            taskId: item.taskId,
            action: "snooze",
          })
          break
        case "dismiss":
          await handlers.onDecide({
            riskType: item.riskType,
            subjectKey: item.subjectKey,
            taskId: item.taskId,
            action: "dismiss",
          })
          break
      }
    } finally {
      setPendingKeys((prev) => {
        const next = { ...prev }
        delete next[item.key]
        return next
      })
    }
  }

  return (
    <>
      <RailSection
        title="Needs you"
        icon={ShieldAlert}
        count={items.length + suggestions.length}
        action={
          archive.length > 0 ? (
            <button
              type="button"
              onClick={() => setArchiveOpen(true)}
              className="inline-flex h-7 items-center gap-1 rounded-sm px-1.5 text-[11px] uppercase text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Archive className="h-3 w-3" aria-hidden="true" />
              <span>Archive</span>
              <span className="num">{archive.length}</span>
            </button>
          ) : undefined
        }
      >
        {reentry ? <ReentryNote reentry={reentry} /> : null}

        {suggestions.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {suggestions.map((suggestion) => {
              const key = `suggestion:${suggestion.taskId}`
              const isPending = Boolean(pendingKeys[key])
              const disabled = isPending || isPlanning

              return (
                <li key={key} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 text-copper" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="line-clamp-1 text-[12px] font-medium text-foreground">{suggestion.title}</span>
                      <span className="num text-[10px] uppercase text-copper">suggested</span>
                    </div>
                    <p className="mt-0.5 line-clamp-3 text-[12px] leading-5 text-muted-foreground">
                      Deadline {formatSuggestedDate(suggestion.suggestedDeadline)} — {suggestion.reason}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void runSuggestionAction(suggestion, "accept")}
                        disabled={disabled}
                        className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-copper/50 bg-copper-soft px-2 text-[11px] font-medium uppercase text-copper transition-colors hover:bg-copper-soft/70 disabled:opacity-50"
                      >
                        {isPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
                        <span>Set deadline</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void runSuggestionAction(suggestion, "keep")}
                        disabled={disabled}
                        className="inline-flex h-7 items-center rounded-sm border border-rule px-2 text-[11px] uppercase text-muted-foreground transition-colors hover:border-rule-strong hover:text-foreground disabled:opacity-50"
                      >
                        Keep undated
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}

        {suggestions.length > 0 ? (
          <button
            type="button"
            onClick={() => setDeadlinesOpen(true)}
            className="-mt-1 self-start text-[11px] uppercase text-muted-foreground transition-colors hover:text-foreground"
          >
            Review all deadlines →
          </button>
        ) : null}

        {items.length === 0 && suggestions.length === 0 ? (
          <p className="text-[12px] leading-5 text-muted-foreground">
            Nothing needs you right now.
          </p>
        ) : null}

        {items.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {items.map((item) => {
              const config = RISK_TYPE_CONFIG[item.riskType]
              const isPending = Boolean(pendingKeys[item.key])
              const disabled = isPending || isPlanning
              // "Mark done" only applies when the risk still points at a live task.
              const secondaries = config.secondaries.filter(
                (action) => action.kind !== "complete" || Boolean(item.taskId),
              )

              return (
                <li key={item.key} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2">
                  <ShieldAlert
                    className={`mt-0.5 h-3.5 w-3.5 ${item.severity === "high" ? "text-destructive" : "text-copper"}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="line-clamp-1 text-[12px] font-medium text-foreground">{item.title}</span>
                      <span className={`num text-[10px] uppercase ${severityTone(item.severity)}`}>{item.severity}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-muted-foreground">{item.detail}</p>

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void runAction(item, config.primary)}
                        disabled={disabled}
                        className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-copper/50 bg-copper-soft px-2 text-[11px] font-medium uppercase text-copper transition-colors hover:bg-copper-soft/70 disabled:opacity-50"
                      >
                        {isPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
                        <span>{config.primary.label}</span>
                      </button>
                      {secondaries.map((action) => (
                        <button
                          key={action.label}
                          type="button"
                          onClick={() => void runAction(item, action)}
                          disabled={disabled}
                          className="inline-flex h-7 items-center rounded-sm border border-rule px-2 text-[11px] uppercase text-muted-foreground transition-colors hover:border-rule-strong hover:text-foreground disabled:opacity-50"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}
      </RailSection>

      <RiskArchiveDrawer
        isOpen={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        entries={archive}
        onRestoreTask={handlers.onRestoreTask}
        onClearDecision={handlers.onClearDecision}
      />

      <DeadlinesReviewDrawer
        isOpen={deadlinesOpen}
        onClose={() => setDeadlinesOpen(false)}
        suggestions={suggestions}
        tasks={tasks}
        onAcceptDeadline={handlers.onAcceptDeadline}
        onKeepUndated={handlers.onKeepUndated}
      />
    </>
  )
}
