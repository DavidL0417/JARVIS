"use client"

import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, RefreshCw, ShieldAlert } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { DailyPlan, DailyPlanRiskItem, SourceSnapshotSummary } from "@/types"

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

function riskTone(severity: "low" | "medium" | "high") {
  if (severity === "high") {
    return "destructive"
  }

  if (severity === "medium") {
    return "secondary"
  }

  return "outline"
}

function dedupeRisks(risks: DailyPlanRiskItem[]) {
  const seen = new Set<string>()
  const out: DailyPlanRiskItem[] = []

  for (const risk of risks) {
    const key = `${risk.title}::${risk.detail}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(risk)
  }

  return out
}

function relativeBuiltAt(iso: string, now: number) {
  const built = new Date(iso).getTime()
  if (!Number.isFinite(built)) return null
  const diffMs = now - built
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return "Built just now"
  if (minutes < 60) return `Built ${minutes}m ago`
  const hours = Math.round(diffMs / 3_600_000)
  if (hours < 24) return `Built ${hours}h ago`
  const days = Math.round(diffMs / 86_400_000)
  return `Built ${days}d ago`
}

export function ContextRailPanel({
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
  const now = Date.now()
  const sourceCoverage = (dailyPlan?.sourceCoverage ?? []).filter(shouldShowCoverageItem)
  const risks = dedupeRisks(dailyPlan?.riskItems ?? [])
  const recentSources = latestSourcePerKind(sources).slice(0, 4)
  const basisCount = sourceCoverage.length || recentSources.length
  const builtLabel = dailyPlan?.createdAt ? relativeBuiltAt(dailyPlan.createdAt, now) : null
  const builtMs = dailyPlan?.createdAt ? new Date(dailyPlan.createdAt).getTime() : null
  const isStale = builtMs ? now - builtMs > STALE_PLAN_THRESHOLD_MS : false
  const isErrorState = planStatus === "Error"
  const isScheduling = planStatus === "Scheduling"
  const dimContent = isErrorState || isStale

  return (
    <div className="flex flex-col gap-5 border-b border-rule pb-5">
      {isErrorState ? (
        <div className="flex flex-col gap-2 rounded-sm border border-destructive/50 bg-destructive/10 p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
            <span className="text-[12px] font-semibold uppercase text-destructive">Latest rebuild failed</span>
          </div>
          {planError ? (
            <p className="line-clamp-3 text-[12px] leading-5 text-foreground/90">{planError}</p>
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            Showing {builtLabel ? builtLabel.replace("Built ", "the plan from ") : "the previous plan"}. Risks below may be out of date.
          </p>
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            className="inline-flex h-7 w-fit items-center gap-1.5 rounded-sm border border-destructive/60 bg-destructive/20 px-2 text-[11px] font-medium uppercase text-destructive transition-colors hover:bg-destructive/30 disabled:opacity-50"
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

      <section className={`flex flex-col gap-5 transition-opacity ${dimContent ? "opacity-60" : ""}`}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[13px] font-semibold uppercase text-foreground">Plan Basis</h2>
            <Badge variant="outline" className="rounded-sm">
              {basisCount}
            </Badge>
          </div>

          {builtLabel ? (
            <p className="text-[11px] text-muted-foreground">
              {isScheduling ? "Building…" : builtLabel}
              {isStale && !isErrorState ? " · stale" : ""}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">{isScheduling ? "Building…" : "No plan built yet."}</p>
          )}

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

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-copper" aria-hidden="true" />
              <h2 className="text-[13px] font-semibold uppercase text-foreground">Risk Radar</h2>
            </div>
            <Badge variant={risks.some((risk) => risk.severity === "high") ? "destructive" : "outline"} className="rounded-sm">
              {risks.length}
            </Badge>
          </div>

          {risks.length > 0 ? (
            <div className="flex flex-col gap-2">
              {risks.slice(0, 5).map((risk, index) => (
                <div key={`${risk.title}-${index}`} className="rounded-sm border border-rule bg-secondary/15 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 text-[12px] font-medium text-foreground">{risk.title}</span>
                    <Badge variant={riskTone(risk.severity)} className="rounded-sm">
                      {risk.severity}
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted-foreground">{risk.detail}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] leading-5 text-muted-foreground">No plan risks recorded.</p>
          )}
        </div>
      </section>
    </div>
  )
}
