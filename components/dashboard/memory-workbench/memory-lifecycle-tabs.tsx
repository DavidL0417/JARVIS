"use client"

import { cn } from "@/lib/utils"
import type { MemoryStatus } from "@/types"

const STATUS_LABELS: Record<MemoryStatus, string> = {
  active: "Active",
  archived: "Archived",
  superseded: "Superseded",
  candidate: "Candidate",
  stale: "Stale",
}

// Active / Archived / Superseded always show; Candidate and Stale appear only when
// the consolidation lifecycle has actually produced rows in those buckets.
const ALWAYS: MemoryStatus[] = ["active", "archived", "superseded"]
const CONDITIONAL: MemoryStatus[] = ["candidate", "stale"]

export function MemoryLifecycleTabs({
  status,
  counts,
  onChange,
}: {
  status: MemoryStatus
  counts: Record<MemoryStatus, number>
  onChange: (status: MemoryStatus) => void
}) {
  const tabs = [...ALWAYS, ...CONDITIONAL.filter((value) => counts[value] > 0)]

  return (
    <div className="flex items-center gap-5" role="tablist" aria-label="Memory lifecycle">
      {tabs.map((value) => {
        const active = value === status
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(value)}
            className={cn(
              "-mb-px flex h-9 items-center gap-1.5 border-b text-[11px] font-medium uppercase tracking-wider transition-colors",
              active
                ? "border-copper text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <span>{STATUS_LABELS[value]}</span>
            <span className={cn("num tabular-nums text-[10px]", active ? "text-copper" : "text-muted-foreground/70")}>
              {counts[value] ?? 0}
            </span>
          </button>
        )
      })}
    </div>
  )
}
