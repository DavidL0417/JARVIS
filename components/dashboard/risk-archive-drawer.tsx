"use client"

import { useState } from "react"
import { Archive, Loader2, Undo2 } from "lucide-react"

import { RailSheet } from "@/components/dashboard/rail-sheet"
import type { ArchiveEntry } from "@/lib/needs-you"
import type { RiskType } from "@/lib/risk-types"

/**
 * The reversible home for things that left the "Needs you" rail: long-overdue
 * tasks the 7-day timeout aged out to `missed`, and risks the operator
 * dismissed. No new store — this is a filtered view of the tasks table and the
 * risk_decisions records. Un-archiving returns a task to `todo`; un-dismissing
 * lets the risk reappear on the next plan.
 */
export function RiskArchiveDrawer({
  isOpen,
  onClose,
  entries,
  onRestoreTask,
  onClearDecision,
}: {
  isOpen: boolean
  onClose: () => void
  entries: ArchiveEntry[]
  onRestoreTask: (taskId: string) => Promise<void> | void
  onClearDecision: (input: { riskType: RiskType; subjectKey: string }) => Promise<void> | void
}) {
  const [pending, setPending] = useState<Record<string, boolean>>({})

  const missed = entries.filter((entry) => entry.kind === "missed-task")
  const dismissed = entries.filter((entry) => entry.kind === "dismissed-risk")

  const restore = async (entry: ArchiveEntry) => {
    setPending((prev) => ({ ...prev, [entry.key]: true }))
    try {
      if (entry.kind === "missed-task" && entry.taskId) {
        await onRestoreTask(entry.taskId)
      } else if (entry.kind === "dismissed-risk" && entry.riskType && entry.subjectKey) {
        await onClearDecision({ riskType: entry.riskType, subjectKey: entry.subjectKey })
      }
    } finally {
      setPending((prev) => {
        const next = { ...prev }
        delete next[entry.key]
        return next
      })
    }
  }

  const renderGroup = (title: string, group: ArchiveEntry[], restoreLabel: string) => {
    if (group.length === 0) {
      return null
    }

    return (
      <section className="flex flex-col gap-3 border-b border-rule pb-5 last:border-b-0 last:pb-0">
        <div className="flex h-7 items-center gap-2">
          <h3 className="eyebrow truncate">{title}</h3>
          <span className="num text-[11px] font-medium text-muted-foreground">{group.length}</span>
        </div>
        <ul className="flex flex-col gap-2">
          {group.map((entry) => {
            const isPending = Boolean(pending[entry.key])

            return (
              <li
                key={entry.key}
                className="flex items-start justify-between gap-2 border-b border-rule/50 pb-2 last:border-b-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="line-clamp-2 text-[12px] font-medium leading-5 text-foreground">{entry.title}</p>
                  {entry.detail ? (
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{entry.detail}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void restore(entry)}
                  disabled={isPending}
                  aria-label={`${restoreLabel} ${entry.title}`}
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm border border-rule px-2 text-[11px] uppercase text-muted-foreground transition-colors hover:border-rule-strong hover:text-foreground disabled:opacity-50"
                >
                  {isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <Undo2 className="h-3 w-3" aria-hidden="true" />
                  )}
                  <span>{restoreLabel}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    )
  }

  return (
    <RailSheet isOpen={isOpen} onClose={onClose} title="Archive" width="narrow">
      {entries.length === 0 ? (
        <div className="flex flex-col items-start gap-2 pt-2">
          <Archive className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <p className="text-[12px] leading-5 text-muted-foreground">
            Nothing archived. Dismissed risks and long-overdue tasks land here, and stay reversible.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {renderGroup("Aged out", missed, "Restore")}
          {renderGroup("Dismissed", dismissed, "Un-dismiss")}
        </div>
      )}
    </RailSheet>
  )
}
