"use client"

import { useMemo, useState } from "react"
import { Loader2, Sparkles, Undo2 } from "lucide-react"

import { RailSection } from "@/components/dashboard/rail-section"
import type { SourceCandidate } from "@/types"

const DIGEST_WINDOW_MS = 24 * 60 * 60 * 1000
const VISIBLE_LIMIT = 6

function describeKind(kind: SourceCandidate["kind"]) {
  if (kind === "deadline") return "Deadline"
  if (kind === "event") return "Event"
  if (kind === "task") return "Task"
  return null
}

function describeDue(dueAt: string | null) {
  if (!dueAt) return null
  const date = new Date(dueAt)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
}

export function AutoImportDigest({
  candidates,
  onUndo,
}: {
  candidates: SourceCandidate[]
  onUndo: (candidateId: string) => Promise<void>
}) {
  const [pendingUndo, setPendingUndo] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState(false)
  const recent = useMemo(() => {
    const cutoff = Date.now() - DIGEST_WINDOW_MS
    return candidates
      .filter((candidate) => candidate.status === "approved" && candidate.approvedTaskId)
      .filter((candidate) => new Date(candidate.updatedAt).getTime() >= cutoff)
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
  }, [candidates])

  if (recent.length === 0) {
    return null
  }

  const visible = expanded ? recent : recent.slice(0, VISIBLE_LIMIT)
  const hidden = recent.length - visible.length

  const handleUndo = async (candidateId: string) => {
    setPendingUndo((prev) => ({ ...prev, [candidateId]: true }))
    try {
      await onUndo(candidateId)
    } finally {
      setPendingUndo((prev) => {
        const next = { ...prev }
        delete next[candidateId]
        return next
      })
    }
  }

  return (
    <RailSection title="JARVIS added" icon={Sparkles} count={recent.length}>
      <p className="text-[11px] leading-4 text-muted-foreground">
        Auto-imported in the last 24h. Undo anything that shouldn&apos;t be here.
      </p>

      <ul className="flex flex-col gap-2">
        {visible.map((candidate) => {
          const kindLabel = describeKind(candidate.kind)
          const dueLabel = describeDue(candidate.dueAt)
          const meta = [kindLabel, candidate.course, dueLabel].filter((part): part is string => Boolean(part)).join(" · ")
          const isUndoing = Boolean(pendingUndo[candidate.id])

          return (
            <li
              key={candidate.id}
              className="flex items-start justify-between gap-2 border-b border-rule/50 pb-2 last:border-b-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="line-clamp-2 text-[12px] font-medium leading-5 text-foreground">{candidate.title}</p>
                {meta ? <p className="mt-0.5 text-[11px] text-muted-foreground">{meta}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => void handleUndo(candidate.id)}
                disabled={isUndoing}
                aria-label={`Undo ${candidate.title}`}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm border border-rule px-2 text-[11px] uppercase text-muted-foreground transition-colors hover:border-rule-strong hover:text-foreground disabled:opacity-50"
              >
                {isUndoing ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                ) : (
                  <Undo2 className="h-3 w-3" aria-hidden="true" />
                )}
                <span>Undo</span>
              </button>
            </li>
          )
        })}
      </ul>

      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="self-start text-[11px] uppercase text-muted-foreground transition-colors hover:text-foreground"
        >
          Show {hidden} more
        </button>
      ) : expanded && recent.length > VISIBLE_LIMIT ? (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="self-start text-[11px] uppercase text-muted-foreground transition-colors hover:text-foreground"
        >
          Show fewer
        </button>
      ) : null}
    </RailSection>
  )
}
