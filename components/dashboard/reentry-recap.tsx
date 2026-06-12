"use client"

import { useEffect, useState } from "react"
import { Clock3, X } from "lucide-react"

import { RailSection } from "@/components/dashboard/rail-section"
import type { DashboardReentry } from "@/types"

const DISMISS_KEY = "jarvis-reentry-dismissed-at"

/**
 * Calm "while you were away" recap shown after a multi-day gap. No modal, no
 * red badges, no guilt — one quiet section the user can dismiss. Dismissal is
 * remembered briefly so it doesn't reappear on the next refresh of the same gap.
 */
export function ReentryRecap({ reentry }: { reentry: DashboardReentry | null }) {
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    if (!reentry) {
      return
    }
    const dismissedAt = window.localStorage.getItem(DISMISS_KEY)
    // Re-show if the last dismissal was more than 12h ago (a genuinely new return).
    const stale = !dismissedAt || Date.now() - Number(dismissedAt) > 12 * 60 * 60 * 1000
    setDismissed(!stale)
  }, [reentry])

  if (!reentry || dismissed) {
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
    <RailSection
      title={`Away ${reentry.gapDays} day${reentry.gapDays === 1 ? "" : "s"}`}
      icon={Clock3}
      action={
        <button
          type="button"
          onClick={() => {
            window.localStorage.setItem(DISMISS_KEY, String(Date.now()))
            setDismissed(true)
          }}
          aria-label="Dismiss recap"
          className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      }
    >
      <p className="text-[12px] leading-5 text-muted-foreground">
        {parts.length > 0
          ? `Nothing was lost. ${parts.join(" · ")}. Build today's plan when you're ready — it reconciles the rest.`
          : "Welcome back. Your schedule is reconciled and ready."}
      </p>
    </RailSection>
  )
}
