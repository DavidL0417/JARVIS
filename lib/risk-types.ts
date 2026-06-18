// Single source of truth for the "Needs you" rail risk taxonomy.
//
// A risk is derived (lib/daily-plan.ts deriveRiskItems), surfaced as an
// action-first card (components/dashboard/needs-you-panel.tsx), and parked
// through a decision (app/api/risks/decisions). All three read the riskType
// from here so the enum, the lifecycle table check constraint, and the card
// actions never drift.

export const RISK_TYPES = [
  "overdue",
  "deadline_no_block",
  "unschedulable",
  "overloaded_day",
  "compression",
  "source_failed",
] as const

export type RiskType = (typeof RISK_TYPES)[number]

export function isRiskType(value: unknown): value is RiskType {
  return typeof value === "string" && (RISK_TYPES as readonly string[]).includes(value)
}

/**
 * Recover a riskType from a legacy plan row written before risks carried one.
 * Best-effort from the title; such rows are replaced on the next plan build, so
 * the only job here is to keep the read model total and never throw.
 */
export function inferRiskTypeFromTitle(title: string): RiskType {
  const normalized = title.toLowerCase()
  if (normalized.includes("overdue")) return "overdue"
  if (normalized.includes("deadline")) return "deadline_no_block"
  if (normalized.includes("fit") || normalized.includes("unschedul")) return "unschedulable"
  if (normalized.includes("overloaded")) return "overloaded_day"
  if (normalized.includes("compression")) return "compression"
  if (normalized.includes("source")) return "source_failed"
  return "overdue"
}

/**
 * Each risk card carries a primary "fix it" action plus reversible secondaries —
 * no item is ever just text. Primary "fix" actions all flow through a targeted
 * replan (reusing the existing planner); "done" completes the task; "snooze" and
 * "dismiss" write a decision row. The command is the replan prompt for fix actions.
 */
export type RiskActionKind = "replan" | "complete" | "snooze" | "dismiss"

export interface RiskActionConfig {
  kind: RiskActionKind
  label: string
}

export interface RiskTypeConfig {
  /** Short eyebrow label for the card. */
  label: string
  /** Whether this risk is scoped to a single task (vs. an aggregate day/week). */
  taskScoped: boolean
  /** The one primary action. */
  primary: RiskActionConfig
  /** Reversible secondaries, in display order. */
  secondaries: RiskActionConfig[]
}

const DISMISS: RiskActionConfig = { kind: "dismiss", label: "Dismiss" }
const SNOOZE: RiskActionConfig = { kind: "snooze", label: "Snooze" }
const MARK_DONE: RiskActionConfig = { kind: "complete", label: "Mark done" }

export const RISK_TYPE_CONFIG: Record<RiskType, RiskTypeConfig> = {
  overdue: {
    label: "Overdue work",
    taskScoped: true,
    primary: { kind: "replan", label: "Reschedule" },
    secondaries: [MARK_DONE, DISMISS],
  },
  deadline_no_block: {
    label: "Deadline without block",
    taskScoped: true,
    primary: { kind: "replan", label: "Schedule it" },
    secondaries: [SNOOZE],
  },
  unschedulable: {
    label: "Planner couldn't fit",
    taskScoped: true,
    primary: { kind: "replan", label: "Make room" },
    secondaries: [{ kind: "dismiss", label: "Mark unschedulable" }],
  },
  overloaded_day: {
    label: "Overloaded day",
    taskScoped: false,
    primary: { kind: "replan", label: "Spread work" },
    secondaries: [DISMISS],
  },
  compression: {
    label: "Compression ahead",
    taskScoped: false,
    primary: { kind: "replan", label: "Spread work" },
    secondaries: [DISMISS],
  },
  source_failed: {
    label: "Source refresh failed",
    taskScoped: false,
    primary: { kind: "replan", label: "Retry sync" },
    secondaries: [DISMISS],
  },
}

/** Default snooze window when the operator snoozes a risk. */
export const DEFAULT_SNOOZE_MS = 24 * 60 * 60 * 1000
