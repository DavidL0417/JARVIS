"use client"

import { useState } from "react"
import { AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, Loader2, RefreshCw } from "lucide-react"

import { cn } from "@/lib/utils"
import type { DailyPlan, SourceSnapshotSummary } from "@/types"

const OPTIONAL_SOURCE_LABELS = new Set(["notion", "gmail", "files"])
const STALE_PLAN_THRESHOLD_MS = 6 * 60 * 60 * 1000

type PlanStatus = "Idle" | "Scheduling" | "Ready" | "Error"

function statusTone(status: string) {
  if (status === "fresh" || status === "connected") {
    return "text-emerald-300"
  }

  if (status === "failed" || status === "missing") {
    return "text-destructive"
  }

  return "text-copper"
}

function shouldShowCoverageItem(item: DailyPlan["sourceCoverage"][number]) {
  const label = item.label.toLowerCase()

  if (!OPTIONAL_SOURCE_LABELS.has(label)) {
    return true
  }

  return item.status !== "missing"
}

function latestSourcePerKind(sources: SourceSnapshotSummary[]) {
  const seen = new Set<string>()
  const latest: SourceSnapshotSummary[] = []

  for (const source of sources) {
    if (seen.has(source.source)) {
      continue
    }

    seen.add(source.source)
    latest.push(source)
  }

  return latest
}

function relativeBuiltAt(iso: string, now: number) {
  const built = new Date(iso).getTime()
  if (!Number.isFinite(built)) return null
  const diffMs = now - built
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return "built just now"
  if (minutes < 60) return `built ${minutes}m ago`
  const hours = Math.round(diffMs / 3_600_000)
  if (hours < 24) return `built ${hours}h ago`
  const days = Math.round(diffMs / 86_400_000)
  return `built ${days}d ago`
}

/**
 * Plan Basis, relocated out of the attention rail to a quiet, collapsed
 * disclosure that sits with the schedule it explains. Provenance — the receipts
 * for the plan — that the operator only needs when a source looks wrong: neutral
 * when healthy, semantic color only when a source is stale or failed. Scoped to
 * the active plan (there is no per-term model yet).
 */
export function PlanBasisDisclosure({
  dailyPlan,
  sources,
  planStatus,
  planError,
  onRetry,
  isRetrying,
}: {
  dailyPlan: DailyPlan | null
  sources: SourceSnapshotSummary[]
  planStatus: PlanStatus
  planError: string
  onRetry: () => void
  isRetrying: boolean
}) {
  const [open, setOpen] = useState(false)
  const now = Date.now()
  const sourceCoverage = (dailyPlan?.sourceCoverage ?? []).filter(shouldShowCoverageItem)
  const recentSources = latestSourcePerKind(sources).slice(0, 4)
  const basisCount = sourceCoverage.length || recentSources.length
  const builtLabel = dailyPlan?.createdAt ? relativeBuiltAt(dailyPlan.createdAt, now) : null
  const builtMs = dailyPlan?.createdAt ? new Date(dailyPlan.createdAt).getTime() : null
  const isStale = builtMs ? now - builtMs > STALE_PLAN_THRESHOLD_MS : false
  const isErrorState = planStatus === "Error"
  const isScheduling = planStatus === "Scheduling"
  const hasFailedSource = sourceCoverage.some((item) => item.status === "failed" || item.status === "missing")

  // Neutral when healthy; semantic color only when something needs the operator.
  const summaryTone = isErrorState || hasFailedSource ? "text-destructive" : isStale ? "text-copper" : "text-muted-foreground"
  const dotTone = isErrorState || hasFailedSource ? "bg-destructive" : isStale ? "bg-copper" : "bg-muted-foreground/50"

  const summaryMeta = isScheduling
    ? "building…"
    : [basisCount > 0 ? `${basisCount} source${basisCount === 1 ? "" : "s"}` : null, builtLabel ?? "no plan yet"]
        .filter(Boolean)
        .join(" · ")

  return (
    <section className="rounded-sm border border-rule">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-accent/40"
      >
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotTone)} aria-hidden="true" />
        <span className="eyebrow shrink-0">Plan basis</span>
        <span className={cn("num truncate text-[10.5px] uppercase", summaryTone)}>{summaryMeta}</span>
        <ChevronDown
          className={cn(
            "ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open ? "rotate-180" : "",
          )}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div className="flex flex-col gap-3 border-t border-rule px-2.5 py-2.5">
          {isErrorState ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                <span className="eyebrow text-destructive">Latest rebuild failed</span>
              </div>
              {planError ? (
                <p className="line-clamp-3 text-[12px] leading-5 text-foreground/90">{planError}</p>
              ) : null}
              <button
                type="button"
                onClick={onRetry}
                disabled={isRetrying}
                className="inline-flex h-7 w-fit items-center gap-1.5 rounded-sm border border-destructive/60 px-2 text-[11px] font-medium uppercase text-destructive transition-colors hover:bg-destructive/15 disabled:opacity-50"
              >
                {isRetrying ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="h-3 w-3" aria-hidden="true" />
                )}
                <span>{isRetrying ? "Retrying" : "Retry build"}</span>
              </button>
            </div>
          ) : null}

          {sourceCoverage.length > 0 ? (
            <div className="flex flex-col gap-2">
              {sourceCoverage.map((item) => (
                <div key={item.label} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2 text-[12px]">
                  {item.status === "fresh" || item.status === "connected" ? (
                    <CheckCircle2 className={`mt-0.5 h-3.5 w-3.5 ${statusTone(item.status)}`} aria-hidden="true" />
                  ) : (
                    <CircleDashed className={`mt-0.5 h-3.5 w-3.5 ${statusTone(item.status)}`} aria-hidden="true" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">{item.label}</span>
                      <span className={`num text-[10px] uppercase ${statusTone(item.status)}`}>{item.status}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 leading-5 text-muted-foreground">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : recentSources.length > 0 ? (
            <div className="flex flex-col gap-2">
              {recentSources.map((source) => (
                <div key={source.id} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2 text-[12px]">
                  <CheckCircle2 className={`mt-0.5 h-3.5 w-3.5 ${statusTone(source.freshness)}`} aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium capitalize text-foreground">{source.source.replace("_", " ")}</span>
                      <span className={`num text-[10px] uppercase ${statusTone(source.freshness)}`}>{source.freshness}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 leading-5 text-muted-foreground">{source.summary}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] leading-5 text-muted-foreground">No plan basis recorded.</p>
          )}
        </div>
      ) : null}
    </section>
  )
}
