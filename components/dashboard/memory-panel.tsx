"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Loader2,
  NotebookText,
  Pencil,
  Tag,
  Trash2,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { MemoryEntrySummary, MemoryImportance } from "@/types"

const IMPORTANCE_RANK: Record<MemoryImportance, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
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

function formatRelative(value: string) {
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

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function importanceTone(importance: MemoryImportance) {
  if (importance === "critical") {
    return "bg-copper shadow-[0_0_0_2px_rgba(255,255,255,0.05),0_0_8px_rgba(217,119,87,0.55)]"
  }

  if (importance === "high") {
    return "bg-copper/85"
  }

  if (importance === "medium") {
    return "bg-muted-foreground/55"
  }

  return "border border-muted-foreground/40 bg-transparent"
}

function importanceLabel(importance: MemoryImportance) {
  if (importance === "critical") return "Core"
  if (importance === "high") return "Strong"
  if (importance === "medium") return "Noted"
  return "Faint"
}

function topImportance(entries: MemoryEntrySummary[]): MemoryImportance {
  return entries.reduce<MemoryImportance>((best, entry) => {
    return IMPORTANCE_RANK[entry.importance] < IMPORTANCE_RANK[best] ? entry.importance : best
  }, "low")
}

function groupByCategory(entries: MemoryEntrySummary[]) {
  const groups = new Map<string, MemoryEntrySummary[]>()

  for (const entry of entries) {
    const key = entry.category || "general"
    const list = groups.get(key) || []
    list.push(entry)
    groups.set(key, list)
  }

  for (const list of groups.values()) {
    list.sort((left, right) => {
      const rank = IMPORTANCE_RANK[left.importance] - IMPORTANCE_RANK[right.importance]
      if (rank !== 0) return rank
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    })
  }

  return Array.from(groups.entries()).sort(([leftKey, leftList], [rightKey, rightList]) => {
    const leftRank = Math.min(...leftList.map((entry) => IMPORTANCE_RANK[entry.importance]))
    const rightRank = Math.min(...rightList.map((entry) => IMPORTANCE_RANK[entry.importance]))

    if (leftRank !== rightRank) return leftRank - rightRank
    return leftKey.localeCompare(rightKey)
  })
}

function CategoryRow({
  category,
  entries,
  active,
  onSelect,
}: {
  category: string
  entries: MemoryEntrySummary[]
  active: boolean
  onSelect: () => void
}) {
  const headerImportance = topImportance(entries)

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group flex w-full min-w-0 items-center gap-3 border-b border-rule/70 py-2.5 pl-3 pr-2 text-left transition-colors",
        active ? "bg-secondary/25" : "hover:bg-secondary/15",
      )}
      aria-pressed={active}
    >
      <Tag
        className={cn(
          "h-3.5 w-3.5 shrink-0 transition-colors",
          active ? "text-copper" : "text-muted-foreground/70 group-hover:text-foreground/80",
        )}
        aria-hidden="true"
        strokeWidth={1.75}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px] font-medium transition-colors",
          active ? "text-foreground" : "text-foreground/85",
        )}
      >
        {titleCase(category)}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        <span
          className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", importanceTone(headerImportance))}
          aria-hidden="true"
        />
        <span className="num">{entries.length}</span>
      </span>
    </button>
  )
}

function CategoryDetailHeader({
  category,
  entries,
}: {
  category: string
  entries: MemoryEntrySummary[]
}) {
  const headerImportance = topImportance(entries)

  return (
    <div className="flex flex-col gap-2 border-b border-rule pb-4">
      <div className="flex items-center gap-2.5">
        <Tag className="h-4 w-4 shrink-0 text-copper" aria-hidden="true" strokeWidth={1.75} />
        <h2 className="truncate text-[15px] font-semibold leading-none text-foreground">
          {titleCase(category)}
        </h2>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <span
            className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", importanceTone(headerImportance))}
            aria-hidden="true"
          />
          {importanceLabel(headerImportance)}
        </span>
      </div>
      <p className="max-w-[64ch] text-[12px] leading-5 text-muted-foreground">
        {entries.length} {entries.length === 1 ? "note" : "notes"} in this section. Click a note to refine.
      </p>
    </div>
  )
}

function InlineError({ message }: { message: string }) {
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

function LedgerStrip({
  items,
}: {
  items: Array<{ label: string; value: number }>
}) {
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

function MemoryEntryItem({
  entry,
  isEditing,
  isBusy,
  draft,
  onStartEdit,
  onChangeDraft,
  onCancel,
  onSave,
  onDiscard,
}: {
  entry: MemoryEntrySummary
  isEditing: boolean
  isBusy: boolean
  draft: string
  onStartEdit: () => void
  onChangeDraft: (value: string) => void
  onCancel: () => void
  onSave: () => void
  onDiscard: () => void
}) {
  return (
    <article
      className={cn(
        "border-b border-rule/60 py-3 transition-colors last:border-b-0",
        isEditing ? "bg-secondary/15 ring-1 ring-copper/30" : "",
      )}
    >
      {isEditing ? (
        <div className="flex flex-col gap-3">
          <Textarea
            value={draft}
            onChange={(event) => onChangeDraft(event.target.value)}
            rows={4}
            autoFocus
            className="min-h-[88px] resize-y border-rule bg-background/60 text-[13px] leading-6 text-foreground focus-visible:ring-copper/40"
            placeholder="Describe what JARVIS should remember…"
          />
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onDiscard}
              disabled={isBusy}
              className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" strokeWidth={1.75} />
              Discard
            </button>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={onCancel}
                disabled={isBusy}
                className="h-7 rounded-sm px-2.5 text-[11px] uppercase tracking-wider"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={onSave}
                disabled={isBusy}
                className="h-7 rounded-sm bg-copper px-2.5 text-[11px] uppercase tracking-wider text-background hover:bg-copper/90"
              >
                {isBusy ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    Saving
                  </>
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onStartEdit}
          className="group/entry flex w-full flex-col gap-1.5 text-left"
          aria-label="Edit this note"
        >
          <p className="text-[13px] leading-6 text-foreground">{entry.insight}</p>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span
              className={cn("inline-block h-1.5 w-1.5 rounded-full", importanceTone(entry.importance))}
              aria-hidden="true"
            />
            <span>{importanceLabel(entry.importance)}</span>
            <span aria-hidden="true">·</span>
            <span className="num">{formatRelative(entry.createdAt)}</span>
            {entry.source ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{entry.source.replace(/_/g, " ")}</span>
              </>
            ) : null}
            <Pencil
              className="ml-auto h-3 w-3 text-muted-foreground/40 opacity-0 transition-opacity group-hover/entry:opacity-100"
              aria-hidden="true"
              strokeWidth={1.75}
            />
          </div>
        </button>
      )}
    </article>
  )
}

export function MemoryPanel({
  memories,
  onMemoriesChanged,
}: {
  memories: MemoryEntrySummary[]
  onMemoriesChanged: () => Promise<void>
}) {
  const grouped = useMemo(() => groupByCategory(memories), [memories])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(
    () => grouped[0]?.[0] ?? null,
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState("")

  const totalEntries = memories.length
  const totalCategories = grouped.length

  const importanceTotals = useMemo(() => {
    const tally: Record<MemoryImportance, number> = { critical: 0, high: 0, medium: 0, low: 0 }
    for (const entry of memories) {
      tally[entry.importance] += 1
    }
    return tally
  }, [memories])

  useEffect(() => {
    if (grouped.length === 0) {
      if (selectedCategory !== null) {
        setSelectedCategory(null)
      }
      return
    }

    if (!selectedCategory || !grouped.some(([key]) => key === selectedCategory)) {
      setSelectedCategory(grouped[0][0])
    }
  }, [grouped, selectedCategory])

  function resetEditState() {
    setEditingId(null)
    setDraft("")
    setErrorMessage("")
  }

  function startEditing(entry: MemoryEntrySummary) {
    setEditingId(entry.id)
    setDraft(entry.insight)
    setErrorMessage("")
  }

  async function saveDraft(entryId: string) {
    const trimmed = draft.trim()

    if (!trimmed) {
      setErrorMessage("Memory cannot be empty. Use discard to remove it.")
      return
    }

    setBusyId(entryId)
    setErrorMessage("")

    try {
      const response = await fetch(`/api/memories/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ insight: trimmed }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        const message =
          payload && typeof payload === "object" && "details" in payload && typeof payload.details === "string"
            ? payload.details
            : payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
              ? payload.error
              : "Failed to save memory."
        throw new Error(message)
      }

      await onMemoriesChanged()
      setEditingId(null)
      setDraft("")
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save memory.")
    } finally {
      setBusyId(null)
    }
  }

  async function discardEntry(entryId: string) {
    setBusyId(entryId)
    setErrorMessage("")

    try {
      const response = await fetch(`/api/memories/${entryId}`, { method: "DELETE" })

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        const message =
          payload && typeof payload === "object" && "details" in payload && typeof payload.details === "string"
            ? payload.details
            : payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
              ? payload.error
              : "Failed to discard memory."
        throw new Error(message)
      }

      await onMemoriesChanged()
      if (editingId === entryId) {
        setEditingId(null)
        setDraft("")
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to discard memory.")
    } finally {
      setBusyId(null)
    }
  }

  const activeEntries = selectedCategory
    ? grouped.find(([key]) => key === selectedCategory)?.[1] ?? []
    : []

  function renderDetail() {
    if (totalEntries === 0) {
      return (
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-2 border-b border-rule pb-4">
            <div className="flex items-center gap-2.5">
              <NotebookText className="h-4 w-4 shrink-0 text-copper" aria-hidden="true" strokeWidth={1.75} />
              <h2 className="truncate text-[15px] font-semibold leading-none text-foreground">
                Notes on you
              </h2>
            </div>
            <p className="max-w-[64ch] text-[12px] leading-5 text-muted-foreground">
              What JARVIS believes about you. As JARVIS reads your sources and watches how you spend
              your time, observations will form here.
            </p>
          </div>
          <div className="rounded-sm border border-rule bg-secondary/10 px-4 py-4">
            <h3 className="text-[13px] font-medium text-foreground">No notes yet</h3>
            <p className="mt-2 max-w-[58ch] text-[12px] leading-5 text-muted-foreground">
              Connect sources or let JARVIS observe your scheduling habits to begin seeding memory.
            </p>
          </div>
        </div>
      )
    }

    if (!selectedCategory) {
      return null
    }

    return (
      <div className="flex min-w-0 flex-col gap-5">
        <CategoryDetailHeader category={selectedCategory} entries={activeEntries} />
        <div className="flex flex-col">
          {activeEntries.map((entry) => (
            <MemoryEntryItem
              key={entry.id}
              entry={entry}
              isEditing={editingId === entry.id}
              isBusy={busyId === entry.id}
              draft={draft}
              onStartEdit={() => startEditing(entry)}
              onChangeDraft={setDraft}
              onCancel={resetEditState}
              onSave={() => void saveDraft(entry.id)}
              onDiscard={() => void discardEntry(entry.id)}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <section className="grid min-h-[calc(100vh-6rem)] min-w-0 grid-cols-1 gap-0 overflow-hidden rounded-sm border border-rule md:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col border-b border-rule bg-background md:border-b-0 md:border-r">
        <header className="flex flex-col gap-2 border-b border-rule px-3 py-4">
          <div className="flex items-center gap-2">
            <NotebookText className="h-4 w-4 shrink-0 text-copper" aria-hidden="true" strokeWidth={1.75} />
            <h2 className="truncate text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground">
              Notes on you
            </h2>
            {busyId ? (
              <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin text-copper" aria-hidden="true" />
                Working
              </span>
            ) : null}
          </div>
          <p className="max-w-[40ch] text-[12px] leading-5 text-muted-foreground">
            Choose a section to read or refine.
          </p>
        </header>

        <div className="flex flex-col">
          <h3 className="border-b border-rule/70 pb-2 pl-3 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
            Sections
          </h3>
          {grouped.length === 0 ? (
            <p className="px-3 py-4 text-[12px] leading-5 text-muted-foreground">
              No notes yet.
            </p>
          ) : (
            grouped.map(([category, entries]) => (
              <CategoryRow
                key={category}
                category={category}
                entries={entries}
                active={selectedCategory === category}
                onSelect={() => {
                  resetEditState()
                  setSelectedCategory(category)
                }}
              />
            ))
          )}
        </div>
      </div>

      <div className="min-w-0 overflow-y-auto bg-secondary/5 px-5 py-5">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
          {renderDetail()}
          <InlineError message={errorMessage} />
          <LedgerStrip
            items={[
              { label: "Notes", value: totalEntries },
              { label: "Sections", value: totalCategories },
              { label: "Core", value: importanceTotals.critical },
              { label: "Strong", value: importanceTotals.high },
            ]}
          />
        </div>
      </div>
    </section>
  )
}
