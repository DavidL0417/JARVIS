"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import {
  MEMORY_LAYER_ORDER,
  MemoryInlineError,
  MemoryLedgerStrip,
} from "@/components/dashboard/memory-shared"
import type { MemoryImportance, MemoryItemDetail, MemoryLayer, MemoryStatus } from "@/types"

import { MemoryLifecycleTabs } from "./memory-lifecycle-tabs"
import { MemoryList } from "./memory-list"
import { MemoryToolbar, type MemoryCreateInput } from "./memory-toolbar"

interface MemoryListResponse {
  memories: MemoryItemDetail[]
  counts: Record<MemoryStatus, number>
}

const EMPTY_COUNTS: Record<MemoryStatus, number> = {
  active: 0,
  archived: 0,
  superseded: 0,
  candidate: 0,
  stale: 0,
}

// Single-user scale: one fetch of every status (head-counted server-side) is far
// snappier than re-querying per tab, and lets filters/search resolve on the client.
const FETCH_LIMIT = 500

// Layer groups default to collapsed; the user's expand/collapse layout persists here.
const EXPANDED_STORAGE_KEY = "jarvis-memory-expanded-layers"

function readExpandedLayers(): Set<MemoryLayer> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = window.localStorage.getItem(EXPANDED_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((value): value is MemoryLayer => MEMORY_LAYER_ORDER.includes(value as MemoryLayer)))
    }
  } catch {
    // Corrupt or absent state falls back to all-collapsed.
  }
  return new Set()
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null)
  if (payload && typeof payload === "object") {
    if ("details" in payload && typeof payload.details === "string") return payload.details
    if ("error" in payload && typeof payload.error === "string") return payload.error
  }
  return fallback
}

export function MemoryWorkbench({ onChanged }: { onChanged: () => void }) {
  const [allMemories, setAllMemories] = useState<MemoryItemDetail[]>([])
  const [counts, setCounts] = useState<Record<MemoryStatus, number>>(EMPTY_COUNTS)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState("")
  const [refreshNonce, setRefreshNonce] = useState(0)

  const [status, setStatus] = useState<MemoryStatus>("active")
  const [layer, setLayer] = useState<MemoryLayer | "all">("all")
  const [importance, setImportance] = useState<MemoryImportance | "all">("all")
  const [category, setCategory] = useState<string>("all")
  const [search, setSearch] = useState("")

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [expandedLayers, setExpandedLayers] = useState<Set<MemoryLayer>>(() => readExpandedLayers())

  useEffect(() => {
    let cancelled = false

    async function load() {
      setIsLoading(true)
      try {
        const response = await fetch(`/api/memories?status=all&limit=${FETCH_LIMIT}`, { cache: "no-store" })
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, "Failed to load memories."))
        }
        const data = (await response.json()) as MemoryListResponse
        if (cancelled) return
        setAllMemories(data.memories ?? [])
        setCounts(data.counts ?? EMPTY_COUNTS)
        setErrorMessage("")
      } catch (error) {
        if (cancelled) return
        setErrorMessage(error instanceof Error ? error.message : "Failed to load memories.")
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [refreshNonce])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(Array.from(expandedLayers)))
  }, [expandedLayers])

  const triggerRefresh = useCallback(() => setRefreshNonce((value) => value + 1), [])

  const bucket = useMemo(
    () => allMemories.filter((memory) => memory.status === status),
    [allMemories, status],
  )

  const categoryOptions = useMemo(() => {
    const set = new Set<string>()
    for (const memory of bucket) {
      set.add(memory.category || "general")
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [bucket])

  const normalizedSearch = search.trim().toLowerCase()
  const filtered = useMemo(() => {
    return bucket.filter((memory) => {
      if (layer !== "all" && memory.layer !== layer) return false
      if (importance !== "all" && memory.importance !== importance) return false
      if (category !== "all" && (memory.category || "general") !== category) return false
      if (normalizedSearch && !memory.insight.toLowerCase().includes(normalizedSearch)) return false
      return true
    })
  }, [bucket, layer, importance, category, normalizedSearch])

  const filtersActive = layer !== "all" || importance !== "all" || category !== "all" || normalizedSearch !== ""
  const selectable = status !== "archived"

  const presentLayers = useMemo(() => {
    const present = new Set(filtered.map((memory) => memory.layer))
    return MEMORY_LAYER_ORDER.filter((layerKey) => present.has(layerKey))
  }, [filtered])

  const allLayersExpanded =
    presentLayers.length > 0 && presentLayers.every((layerKey) => expandedLayers.has(layerKey))

  const toggleLayer = useCallback((layerKey: MemoryLayer) => {
    setExpandedLayers((prev) => {
      const next = new Set(prev)
      if (next.has(layerKey)) {
        next.delete(layerKey)
      } else {
        next.add(layerKey)
      }
      return next
    })
  }, [])

  const setAllLayersExpanded = useCallback(
    (expand: boolean) => {
      setExpandedLayers(expand ? new Set(presentLayers) : new Set())
    },
    [presentLayers],
  )

  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  const handleStatusChange = useCallback((next: MemoryStatus) => {
    setStatus(next)
    setCategory("all")
    setSelectedIds(new Set())
  }, [])

  const resetFilters = useCallback(() => {
    setLayer("all")
    setImportance("all")
    setCategory("all")
    setSearch("")
  }, [])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleSave = useCallback(
    async (id: string, patch: { insight?: string; importance?: MemoryImportance }) => {
      setBusyId(id)
      setErrorMessage("")
      try {
        const response = await fetch(`/api/memories/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        })
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, "Failed to save memory."))
        }
        triggerRefresh()
        onChanged()
        return true
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Failed to save memory.")
        return false
      } finally {
        setBusyId(null)
      }
    },
    [onChanged, triggerRefresh],
  )

  const handleArchive = useCallback(
    async (id: string) => {
      setBusyId(id)
      setErrorMessage("")
      try {
        const response = await fetch(`/api/memories/${id}`, { method: "DELETE" })
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, "Failed to archive memory."))
        }
        triggerRefresh()
        onChanged()
        return true
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Failed to archive memory.")
        return false
      } finally {
        setBusyId(null)
      }
    },
    [onChanged, triggerRefresh],
  )

  const handleRestore = useCallback(
    async (id: string) => {
      setBusyId(id)
      setErrorMessage("")
      try {
        const response = await fetch(`/api/memories/${id}/restore`, { method: "POST" })
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, "Failed to restore memory."))
        }
        triggerRefresh()
        onChanged()
        return true
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Failed to restore memory.")
        return false
      } finally {
        setBusyId(null)
      }
    },
    [onChanged, triggerRefresh],
  )

  const handleCreate = useCallback(
    async (input: MemoryCreateInput) => {
      setCreating(true)
      setErrorMessage("")
      try {
        const response = await fetch("/api/memories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            insight: input.insight,
            layer: input.layer,
            importance: input.importance,
            category: input.category,
          }),
        })
        if (!response.ok) {
          throw new Error(await readErrorMessage(response, "Failed to create memory."))
        }
        triggerRefresh()
        onChanged()
        return true
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Failed to create memory.")
        return false
      } finally {
        setCreating(false)
      }
    },
    [onChanged, triggerRefresh],
  )

  const handleBulkArchive = useCallback(async () => {
    if (selectedIds.size === 0) return
    setBulkBusy(true)
    setErrorMessage("")
    try {
      const response = await fetch("/api/memories/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive", ids: Array.from(selectedIds) }),
      })
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to archive memories."))
      }
      setSelectedIds(new Set())
      triggerRefresh()
      onChanged()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to archive memories.")
    } finally {
      setBulkBusy(false)
    }
  }, [onChanged, selectedIds, triggerRefresh])

  const importanceTotals = useMemo(() => {
    const tally = { critical: 0, high: 0 }
    for (const memory of filtered) {
      if (memory.importance === "critical") tally.critical += 1
      if (memory.importance === "high") tally.high += 1
    }
    return tally
  }, [filtered])

  const distinctCategories = useMemo(() => {
    const set = new Set(filtered.map((memory) => memory.category || "general"))
    return set.size
  }, [filtered])

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <MemoryToolbar
        search={search}
        onSearchChange={setSearch}
        layer={layer}
        onLayerChange={setLayer}
        importance={importance}
        onImportanceChange={setImportance}
        category={category}
        onCategoryChange={setCategory}
        categoryOptions={categoryOptions}
        filtersActive={filtersActive}
        onResetFilters={resetFilters}
        onCreate={handleCreate}
        creating={creating}
        selectedCount={selectedIds.size}
        onBulkArchive={() => void handleBulkArchive()}
        onClearSelection={clearSelection}
        bulkBusy={bulkBusy}
      />

      <div className="flex items-center justify-between gap-4 border-b border-rule">
        <MemoryLifecycleTabs status={status} counts={counts} onChange={handleStatusChange} />
        {presentLayers.length > 1 && !filtersActive ? (
          <button
            type="button"
            onClick={() => setAllLayersExpanded(!allLayersExpanded)}
            className="shrink-0 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          >
            {allLayersExpanded ? "Collapse all" : "Expand all"}
          </button>
        ) : null}
      </div>

      <MemoryInlineError message={errorMessage} />

      <div className="rail-scroll min-h-0 flex-1 overflow-y-auto pr-1">
        <MemoryList
          memories={filtered}
          status={status}
          loading={isLoading}
          filtersActive={filtersActive}
          selectable={selectable}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          busyId={busyId}
          handlers={{ onSave: handleSave, onArchive: handleArchive, onRestore: handleRestore }}
          expandedLayers={expandedLayers}
          onToggleLayer={toggleLayer}
          forceExpand={filtersActive}
        />
      </div>

      {status === "active" && filtered.length > 0 ? (
        <MemoryLedgerStrip
          items={[
            { label: "Notes", value: filtered.length },
            { label: "Sections", value: distinctCategories },
            { label: "Core", value: importanceTotals.critical },
            { label: "Strong", value: importanceTotals.high },
          ]}
        />
      ) : null}
    </div>
  )
}
