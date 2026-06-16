"use client"

import { AlertTriangle } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { cn } from "@/lib/utils"
import type { MemoryImportance, MemoryLayer } from "@/types"

// Shared memory presentation helpers. Lifted out of the retired MemoryPanel so the
// workbench and any future memory surface read from one source of truth.

export const IMPORTANCE_RANK: Record<MemoryImportance, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

// Highest-to-lowest, so the editor and filters read top-down by weight.
export const MEMORY_IMPORTANCE_OPTIONS: Array<{ value: MemoryImportance; label: string }> = [
  { value: "critical", label: "Core" },
  { value: "high", label: "Strong" },
  { value: "medium", label: "Noted" },
  { value: "low", label: "Faint" },
]

export const MEMORY_LAYER_OPTIONS: Array<{ value: MemoryLayer; label: string }> = [
  { value: "operating_rules", label: "Operating rules" },
  { value: "planning_profile", label: "Planning profile" },
  { value: "durable_preferences", label: "Durable preferences" },
  { value: "task_context", label: "Task context" },
  { value: "deadline_context", label: "Deadline context" },
  { value: "calendar_context", label: "Calendar context" },
  { value: "source_status", label: "Source status" },
  { value: "feedback_observations", label: "Feedback observations" },
  { value: "candidate_memories", label: "Candidate memories" },
]

// Canonical layer order — mirrors how the planner ingests memory. Groups render
// in this order, never alphabetically.
export const MEMORY_LAYER_ORDER: MemoryLayer[] = MEMORY_LAYER_OPTIONS.map((option) => option.value)

const LAYER_LABELS = new Map(MEMORY_LAYER_OPTIONS.map((option) => [option.value, option.label]))

export function layerLabel(layer: MemoryLayer): string {
  return LAYER_LABELS.get(layer) ?? titleCase(layer)
}

const RELATIVE_DIVISIONS: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
]

export function formatRelative(value: string) {
  const target = new Date(value).getTime()
  const now = Date.now()
  let duration = (target - now) / 1000

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })

  for (const division of RELATIVE_DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return formatter.format(Math.round(duration), division.unit)
    }

    duration /= division.amount
  }

  return formatter.format(Math.round(duration), "year")
}

export function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

// Four-step importance glyph: emphasis comes from the copper accent and the dot's
// fill state, never a heavy fill. Matches the rest of the app.
export function importanceTone(importance: MemoryImportance) {
  if (importance === "critical") {
    return "bg-copper"
  }

  if (importance === "high") {
    return "border border-copper bg-transparent"
  }

  if (importance === "medium") {
    return "bg-muted-foreground/60"
  }

  return "border border-muted-foreground/40 bg-transparent"
}

export function importanceLabel(importance: MemoryImportance) {
  if (importance === "critical") return "Core"
  if (importance === "high") return "Strong"
  if (importance === "medium") return "Noted"
  return "Faint"
}

export function topImportance<T extends { importance: MemoryImportance }>(entries: T[]): MemoryImportance {
  return entries.reduce<MemoryImportance>((best, entry) => {
    return IMPORTANCE_RANK[entry.importance] < IMPORTANCE_RANK[best] ? entry.importance : best
  }, "low")
}

export function groupByLayer<T extends { layer: MemoryLayer; importance: MemoryImportance; createdAt: string }>(
  entries: T[],
): Array<[MemoryLayer, T[]]> {
  const groups = new Map<MemoryLayer, T[]>()

  for (const entry of entries) {
    const list = groups.get(entry.layer) || []
    list.push(entry)
    groups.set(entry.layer, list)
  }

  for (const list of groups.values()) {
    list.sort((left, right) => {
      const rank = IMPORTANCE_RANK[left.importance] - IMPORTANCE_RANK[right.importance]
      if (rank !== 0) return rank
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    })
  }

  return MEMORY_LAYER_ORDER.filter((layer) => groups.has(layer)).map(
    (layer) => [layer, groups.get(layer) as T[]] as [MemoryLayer, T[]],
  )
}

export function MemoryInlineError({ message }: { message: string }) {
  if (!message) {
    return null
  }

  return (
    <Alert variant="destructive" className="min-w-0 rounded-sm border-destructive/40 bg-destructive/5 text-[12px]">
      <AlertTriangle aria-hidden="true" />
      <AlertTitle className="text-[12px]">Memory action failed</AlertTitle>
      <AlertDescription className="max-w-full text-[12px] leading-5 [overflow-wrap:anywhere]">
        {message}
      </AlertDescription>
    </Alert>
  )
}

export function MemoryLedgerStrip({ items }: { items: Array<{ label: string; value: number }> }) {
  return (
    <div className="flex min-w-0 items-stretch divide-x divide-rule/60 border-t border-rule/70 pt-3">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-1 items-baseline gap-2 px-3 first:pl-0 last:pr-0">
          <span className="num text-[14px] font-semibold leading-none tabular-nums text-foreground">
            {item.value}
          </span>
          <span className="truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {item.label}
          </span>
        </div>
      ))}
    </div>
  )
}

// Four-step importance picker used in the row editor and the add composer. Reuses
// the same glyph vocabulary as the read view so editing feels continuous.
export function ImportancePicker({
  value,
  onChange,
  disabled,
}: {
  value: MemoryImportance
  onChange: (next: MemoryImportance) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Importance">
      {MEMORY_IMPORTANCE_OPTIONS.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[10px] uppercase tracking-wider transition-colors disabled:opacity-50",
              active
                ? "border-copper/50 bg-copper-soft text-copper"
                : "border-transparent text-muted-foreground hover:border-rule-strong hover:text-foreground",
            )}
          >
            <span className={cn("inline-block h-1.5 w-1.5 rounded-full", importanceTone(option.value))} aria-hidden="true" />
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
