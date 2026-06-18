// Pure read-time consolidation for the "Needs you" rail.
//
// The plan stores raw derived risks; the operator's decisions live in
// risk_decisions; tasks carry their own lifecycle. This overlays all three into
// the single attention surface — applying snooze/dismiss and dropping risks the
// operator already resolved (completed or aged-out tasks) — without re-running
// the planner. Kept pure and UI-free so it is trivially testable.

import { RISK_TYPE_CONFIG, type RiskType } from "@/lib/risk-types"
import type { DailyPlanRiskItem, RiskDecision, Task } from "@/types"

export interface NeedsYouItem {
  key: string
  riskType: RiskType
  subjectKey: string
  taskId: string | null
  title: string
  detail: string
  severity: DailyPlanRiskItem["severity"]
}

export interface ArchiveEntry {
  key: string
  kind: "dismissed-risk" | "missed-task"
  title: string
  detail: string | null
  taskId: string | null
  riskType: RiskType | null
  subjectKey: string | null
}

// An undated task JARVIS proposes a by-when for (Workstream 2). Surfaced as its
// own "Needs you" item type — Set deadline / Keep undated — never written silently.
export interface SuggestedDeadlineItem {
  taskId: string
  title: string
  suggestedDeadline: string
  reason: string
}

const SEVERITY_RANK: Record<DailyPlanRiskItem["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
}

function pairKey(riskType: string, subjectKey: string) {
  return `${riskType}::${subjectKey}`
}

function aggregateDetail(subjectKey: string) {
  return subjectKey
}

function missedDetail(task: Task): string | null {
  if (!task.deadline) {
    return "Aged out of the plan."
  }

  const deadline = new Date(task.deadline)
  if (Number.isNaN(deadline.getTime())) {
    return "Aged out of the plan."
  }

  return `Deadline ${deadline.toLocaleDateString([], { month: "short", day: "numeric" })} passed.`
}

export function buildNeedsYou(input: {
  riskItems: DailyPlanRiskItem[]
  tasks: Task[]
  decisions: RiskDecision[]
  now?: number
}): { items: NeedsYouItem[]; suggestions: SuggestedDeadlineItem[]; archive: ArchiveEntry[] } {
  const now = input.now ?? Date.now()
  const taskById = new Map(input.tasks.map((task) => [task.id, task]))
  const decisionByKey = new Map(
    input.decisions.map((decision) => [pairKey(decision.riskType, decision.subjectKey), decision]),
  )

  const items: NeedsYouItem[] = []
  const seen = new Set<string>()

  for (const risk of input.riskItems) {
    const config = RISK_TYPE_CONFIG[risk.riskType]
    if (!config) {
      continue
    }

    const key = pairKey(risk.riskType, risk.subjectKey)
    if (seen.has(key)) {
      continue
    }

    // A task-scoped risk is stale the moment its task is resolved — completed by
    // the operator, aged out to missed, or deleted. Drop it without a replan so
    // "Mark done" and the 7-day timeout take effect on the next load.
    if (config.taskScoped) {
      const task = risk.taskId ? taskById.get(risk.taskId) : undefined
      if (!task || task.status === "completed" || task.status === "missed") {
        continue
      }
    }

    const decision = decisionByKey.get(key)
    if (decision) {
      if (decision.archivedAt) {
        continue
      }
      if (decision.dismissedUntil && new Date(decision.dismissedUntil).getTime() > now) {
        continue
      }
    }

    seen.add(key)
    items.push({
      key,
      riskType: risk.riskType,
      subjectKey: risk.subjectKey,
      taskId: risk.taskId ?? null,
      title: config.label,
      detail: risk.detail,
      severity: risk.severity,
    })
  }

  items.sort((left, right) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity])

  // Archive: dismissed risks + aged-out (missed) tasks. Both reversible — the
  // union of two stores that already exist, never a new one.
  const archive: ArchiveEntry[] = []

  for (const decision of input.decisions) {
    if (!decision.archivedAt) {
      continue
    }

    const config = RISK_TYPE_CONFIG[decision.riskType]
    const task = decision.taskId ? taskById.get(decision.taskId) : undefined

    archive.push({
      key: `risk:${pairKey(decision.riskType, decision.subjectKey)}`,
      kind: "dismissed-risk",
      title: config?.label ?? "Dismissed risk",
      detail: task?.title ?? aggregateDetail(decision.subjectKey),
      taskId: decision.taskId,
      riskType: decision.riskType,
      subjectKey: decision.subjectKey,
    })
  }

  for (const task of input.tasks) {
    if (task.status !== "missed") {
      continue
    }

    archive.push({
      key: `task:${task.id}`,
      kind: "missed-task",
      title: task.title,
      detail: missedDetail(task),
      taskId: task.id,
      riskType: null,
      subjectKey: null,
    })
  }

  // Inferred-deadline suggestions: open, still-undated tasks JARVIS proposed a
  // by-when for and the operator hasn't resolved. Explicit deadlines win, so a
  // task that gained a real deadline drops out automatically.
  const suggestions: SuggestedDeadlineItem[] = []

  for (const task of input.tasks) {
    if (task.status === "completed" || task.status === "missed") {
      continue
    }
    if (task.deadline || !task.inferredDeadline || task.inferredDeadlineDismissed) {
      continue
    }

    suggestions.push({
      taskId: task.id,
      title: task.title,
      suggestedDeadline: task.inferredDeadline,
      reason: task.inferredDeadlineReason ?? "JARVIS inferred this from your calendar and context.",
    })
  }

  suggestions.sort(
    (left, right) => new Date(left.suggestedDeadline).getTime() - new Date(right.suggestedDeadline).getTime(),
  )

  return { items, suggestions, archive }
}
