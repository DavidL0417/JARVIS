"use client"

import { CalendarClock, Clock3, Loader2, Moon, RefreshCw, Zap } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { DailyPlan } from "@/types"

const QUICK_REPLANS = [
  {
    label: "Lighter",
    command: "I'm tired, make today lighter.",
    icon: Zap,
  },
  {
    label: "Later",
    command: "Move flexible work later today.",
    icon: Clock3,
  },
  {
    label: "Protect night",
    command: "Keep tonight protected; move non-urgent work earlier or tomorrow.",
    icon: Moon,
  },
] as const

function formatPlanTime(value: string | null) {
  if (!value) {
    return null
  }

  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })
}

function severityCount(plan: DailyPlan | null, severity: "high" | "medium" | "low") {
  return plan?.riskItems.filter((risk) => risk.severity === severity).length ?? 0
}

export function DailyCommandStrip({
  dailyPlan,
  isPlanning,
  plannerSummary,
  plannerStatus,
  onBuild,
  onReplan,
  placement = "top",
}: {
  dailyPlan: DailyPlan | null
  isPlanning: boolean
  plannerSummary: string
  plannerStatus: "Idle" | "Scheduling" | "Ready" | "Error"
  onBuild: () => void
  onReplan: (command: string) => Promise<void>
  placement?: "top" | "side"
}) {
  const nowItem = dailyPlan?.nowItem
  const nextItem = dailyPlan?.nextItems[0]
  const highRisks = severityCount(dailyPlan, "high")
  const mediumRisks = severityCount(dailyPlan, "medium")
  const isSide = placement === "side"

  return (
    <section className={`shrink-0 border-rule-strong ${isSide ? "border-b pb-4 xl:border-b-0 xl:border-r xl:pb-0 xl:pr-4" : "border-b pb-4"}`}>
      <div className={`flex min-w-0 flex-col gap-3 ${isSide ? "xl:sticky xl:top-0" : ""}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onBuild}
            disabled={isPlanning}
            className="h-7 gap-2 rounded-sm border-copper/40 bg-copper-soft px-2.5 text-[11px] font-medium uppercase tracking-wide text-copper hover:bg-copper-soft hover:brightness-110"
          >
            {isPlanning ? (
              <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" />
            ) : (
              <CalendarClock data-icon="inline-start" aria-hidden="true" />
            )}
            Build Today
          </Button>
          <Badge variant="outline" className="rounded-sm border-copper/30 bg-copper-soft text-copper">
            <Zap aria-hidden="true" />
            Now
          </Badge>
          {dailyPlan ? (
            <span className="num text-[11px] font-medium uppercase text-muted-foreground">
              {new Date(dailyPlan.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            </span>
          ) : null}
          {highRisks > 0 || mediumRisks > 0 ? (
            <Badge variant={highRisks > 0 ? "destructive" : "secondary"} className="rounded-sm">
              {highRisks + mediumRisks} risk{highRisks + mediumRisks === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </div>

        <div className="min-w-0">
          <h1 className={`${isSide ? "line-clamp-4 xl:text-[20px]" : "truncate text-[22px]"} font-semibold leading-tight text-foreground`}>
            {nowItem?.title ?? "Build today from live context"}
          </h1>
          <p className={`mt-1 text-[13px] leading-5 text-muted-foreground ${isSide ? "line-clamp-5" : "line-clamp-2 max-w-[76ch]"}`}>
            {nowItem?.why ?? "No daily plan has been generated from sources yet."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
          <span className="num font-medium uppercase text-foreground/80">Next</span>
          <span className="truncate">
            {nextItem
              ? `${formatPlanTime(nextItem.start) ?? "Soon"} ${nextItem.title}`
              : "No next block placed."}
          </span>
        </div>

        <div className={`flex flex-wrap items-center gap-2 ${isSide ? "xl:flex-col xl:items-stretch" : ""}`}>
          {QUICK_REPLANS.map((action) => {
            const Icon = action.icon
            return (
              <Button
                key={action.label}
                size="sm"
                variant="secondary"
                onClick={() => void onReplan(action.command)}
                disabled={isPlanning}
                className={`h-7 gap-1.5 rounded-sm px-2 text-[11px] font-medium ${isSide ? "xl:justify-start" : ""}`}
              >
                <Icon data-icon="inline-start" aria-hidden="true" />
                {action.label}
              </Button>
            )
          })}
          <Button
            size="icon"
            variant={plannerStatus === "Error" ? "destructive" : "ghost"}
            onClick={onBuild}
            disabled={isPlanning}
            aria-label="Refresh daily plan"
            className="size-7 rounded-sm"
          >
            {isPlanning ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          </Button>
        </div>

        {plannerSummary ? (
          <p className={`line-clamp-2 text-[12px] leading-5 ${plannerStatus === "Error" ? "text-destructive" : "text-muted-foreground"}`}>
            {plannerSummary}
          </p>
        ) : null}
      </div>
    </section>
  )
}
