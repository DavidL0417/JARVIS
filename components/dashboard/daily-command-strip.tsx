"use client"

import { useState } from "react"
import { ArrowUp, CalendarClock, Loader2, RefreshCw, Zap } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import type { DailyPlan } from "@/types"

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
}: {
  dailyPlan: DailyPlan | null
  isPlanning: boolean
  plannerSummary: string
  plannerStatus: "Idle" | "Scheduling" | "Ready" | "Error"
  onBuild: () => void
  onReplan: (command: string) => Promise<void>
}) {
  const [command, setCommand] = useState("")
  const nowItem = dailyPlan?.nowItem
  const nextItem = dailyPlan?.nextItems[0]
  const highRisks = severityCount(dailyPlan, "high")
  const mediumRisks = severityCount(dailyPlan, "medium")

  async function handleSubmit() {
    const trimmed = command.trim()

    if (!trimmed || isPlanning) {
      return
    }

    await onReplan(trimmed)
    setCommand("")
  }

  return (
    <section className="grid shrink-0 gap-4 border-b border-rule-strong pb-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,440px)]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onBuild}
            disabled={isPlanning}
            className="h-7 gap-2 rounded-sm border-copper/40 bg-copper-soft px-2.5 text-[11px] font-medium uppercase tracking-wide text-copper hover:bg-copper-soft hover:brightness-110"
          >
            {isPlanning ? <Loader2 className="animate-spin" aria-hidden="true" /> : <CalendarClock aria-hidden="true" />}
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
          <h1 className="truncate text-[26px] font-semibold leading-tight text-foreground">
            {nowItem?.title ?? "Build today from live context"}
          </h1>
          <p className="mt-1 line-clamp-2 max-w-[76ch] text-[13px] leading-5 text-muted-foreground">
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
      </div>

      <div className="flex min-w-0 flex-col justify-end gap-3">
        <div className="flex items-center justify-end">
          <Button
            size="icon"
            variant={plannerStatus === "Error" ? "destructive" : "secondary"}
            onClick={onBuild}
            disabled={isPlanning}
            aria-label="Refresh daily plan"
          >
            {isPlanning ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          </Button>
        </div>

        <InputGroup className="rounded-sm border-rule bg-secondary/25">
          <InputGroupAddon>
            <span className="num text-[10px] uppercase text-muted-foreground">Command</span>
          </InputGroupAddon>
          <InputGroupInput
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void handleSubmit()
              }
            }}
            placeholder="I'm tired, make today lighter."
            disabled={isPlanning}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label="Replan"
              disabled={isPlanning || command.trim().length === 0}
              onClick={() => void handleSubmit()}
            >
              {isPlanning ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>

        {plannerSummary ? (
          <p className={`line-clamp-2 text-[12px] leading-5 ${plannerStatus === "Error" ? "text-destructive" : "text-muted-foreground"}`}>
            {plannerSummary}
          </p>
        ) : null}
      </div>
    </section>
  )
}
