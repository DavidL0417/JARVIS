"use client"

import { useMemo } from "react"
import { ChevronRight } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"
import { groupByLayer, importanceTone, layerLabel, topImportance } from "@/components/dashboard/memory-shared"
import { cn } from "@/lib/utils"
import type { MemoryItemDetail, MemoryLayer, MemoryStatus } from "@/types"

import { MemoryRow, type MemoryRowHandlers } from "./memory-row"

const EMPTY_COPY: Record<MemoryStatus, { title: string; detail: string | null }> = {
  active: {
    title: "Nothing remembered yet.",
    detail:
      "As JARVIS reads your sources and watches how you spend your time, notes form here. You can also add one by hand.",
  },
  archived: { title: "No archived notes.", detail: null },
  superseded: { title: "Nothing has been superseded.", detail: null },
  candidate: { title: "No candidate memories awaiting review.", detail: null },
  stale: { title: "No stale notes.", detail: null },
}

function RowSkeletons() {
  return (
    <div aria-hidden="true">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="flex flex-col gap-2 border-b border-rule/60 py-3 last:border-b-0">
          <Skeleton className="h-4 w-[70%]" />
          <Skeleton className="h-2.5 w-[40%]" />
        </div>
      ))}
    </div>
  )
}

export function MemoryList({
  memories,
  status,
  loading,
  filtersActive,
  selectable,
  selectedIds,
  onToggleSelect,
  busyId,
  handlers,
  expandedLayers,
  onToggleLayer,
  forceExpand,
}: {
  memories: MemoryItemDetail[]
  status: MemoryStatus
  loading: boolean
  filtersActive: boolean
  selectable: boolean
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  busyId: string | null
  handlers: MemoryRowHandlers
  expandedLayers: Set<MemoryLayer>
  onToggleLayer: (layer: MemoryLayer) => void
  forceExpand: boolean
}) {
  const grouped = useMemo(() => groupByLayer(memories), [memories])

  if (loading && memories.length === 0) {
    return <RowSkeletons />
  }

  if (memories.length === 0) {
    if (filtersActive) {
      return <p className="py-6 text-[12px] leading-5 text-muted-foreground">No memories match these filters.</p>
    }

    const copy = EMPTY_COPY[status]
    return (
      <div className="flex flex-col gap-2 py-6">
        <p className="text-[13px] font-medium text-foreground">{copy.title}</p>
        {copy.detail ? <p className="max-w-[52ch] text-[12px] leading-5 text-muted-foreground">{copy.detail}</p> : null}
      </div>
    )
  }

  const renderRow = (entry: MemoryItemDetail) => (
    <MemoryRow
      key={entry.id}
      entry={entry}
      selectable={selectable}
      selected={selectedIds.has(entry.id)}
      onToggleSelect={onToggleSelect}
      busy={busyId === entry.id}
      onSave={handlers.onSave}
      onArchive={handlers.onArchive}
      onRestore={handlers.onRestore}
    />
  )

  return (
    <div className="flex flex-col">
      {grouped.map(([layer, entries]) => {
        const expanded = forceExpand || expandedLayers.has(layer)
        return (
          <section key={layer} className="border-b border-rule/40 last:border-b-0">
            <h3>
              <button
                type="button"
                onClick={() => onToggleLayer(layer)}
                aria-expanded={expanded}
                className="group/layer flex w-full items-center gap-2 py-3 text-left"
              >
                <ChevronRight
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform",
                    expanded && "rotate-90",
                  )}
                  aria-hidden="true"
                  strokeWidth={2}
                />
                <span
                  className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", importanceTone(topImportance(entries)))}
                  aria-hidden="true"
                />
                <span className="eyebrow transition-colors group-hover/layer:text-foreground">{layerLabel(layer)}</span>
                <span className="num text-[11px] font-medium text-muted-foreground">{entries.length}</span>
              </button>
            </h3>
            {expanded ? <div className="flex flex-col pb-1 pl-[1.375rem]">{entries.map(renderRow)}</div> : null}
          </section>
        )
      })}
    </div>
  )
}
