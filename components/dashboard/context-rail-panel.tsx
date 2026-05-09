"use client"

import { CheckCircle2, CircleDashed, ShieldAlert } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { DailyPlan, SourceSnapshotSummary } from "@/types"

const OPTIONAL_SOURCE_LABELS = new Set(["notion", "gmail", "files"])

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

export function ContextRailPanel({
  dailyPlan,
  sources,
}: {
  dailyPlan: DailyPlan | null
  sources: SourceSnapshotSummary[]
}) {
  const sourceCoverage = (dailyPlan?.sourceCoverage ?? []).filter(shouldShowCoverageItem)
  const risks = dailyPlan?.riskItems ?? []
  const recentSources = latestSourcePerKind(sources).slice(0, 4)
  const basisCount = sourceCoverage.length || recentSources.length

  return (
    <section className="flex flex-col gap-5 border-b border-rule pb-5">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[13px] font-semibold uppercase text-foreground">Plan Basis</h2>
          <Badge variant="outline" className="rounded-sm">
            {basisCount}
          </Badge>
        </div>

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
  )
}
