"use client"

import { useState } from "react"
import { Loader2, Plus, Search, X } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  ImportancePicker,
  MEMORY_IMPORTANCE_OPTIONS,
  MEMORY_LAYER_OPTIONS,
  titleCase,
} from "@/components/dashboard/memory-shared"
import { cn } from "@/lib/utils"
import type { MemoryImportance, MemoryLayer } from "@/types"

export interface MemoryCreateInput {
  insight: string
  layer: MemoryLayer
  importance: MemoryImportance
  category: string
}

const TRIGGER_CLASS = "h-8 w-auto min-w-[8rem] rounded-sm border-rule bg-transparent text-[11px]"

function AddComposer({
  onCreate,
  onClose,
  busy,
}: {
  onCreate: (input: MemoryCreateInput) => Promise<boolean>
  onClose: () => void
  busy: boolean
}) {
  const [insight, setInsight] = useState("")
  const [layer, setLayer] = useState<MemoryLayer>("durable_preferences")
  const [importance, setImportance] = useState<MemoryImportance>("medium")
  const [category, setCategory] = useState("")

  async function submit() {
    const trimmed = insight.trim()
    if (!trimmed) {
      return
    }
    const ok = await onCreate({
      insight: trimmed,
      layer,
      importance,
      category: category.trim() || "general",
    })
    if (ok) {
      onClose()
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-sm border border-rule bg-muted/20 p-3">
      <Textarea
        value={insight}
        onChange={(event) => setInsight(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation()
            onClose()
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void submit()
          }
        }}
        rows={3}
        autoFocus
        className="min-h-[72px] resize-y border-rule bg-background/60 text-[13px] leading-6 focus-visible:ring-copper/40"
        placeholder="Tell JARVIS something to remember about you…"
      />
      <div className="flex flex-wrap items-center gap-3">
        <ImportancePicker value={importance} onChange={setImportance} disabled={busy} />
        <Select value={layer} onValueChange={(value) => setLayer(value as MemoryLayer)}>
          <SelectTrigger size="sm" className={TRIGGER_CLASS} aria-label="Layer">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MEMORY_LAYER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value} className="text-[12px]">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          placeholder="Category"
          className="h-8 w-40 rounded-sm border-rule text-[12px]"
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          disabled={busy}
          className="h-7 rounded-sm px-2.5 text-[11px] uppercase tracking-wider"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => void submit()}
          disabled={busy || !insight.trim()}
          className="h-7 rounded-sm bg-copper px-2.5 text-[11px] uppercase tracking-wider text-background hover:bg-copper/90"
        >
          {busy ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Saving
            </>
          ) : (
            "Save note"
          )}
        </Button>
      </div>
    </div>
  )
}

function BulkBar({
  selectedCount,
  onBulkArchive,
  onClearSelection,
  busy,
}: {
  selectedCount: number
  onBulkArchive: () => void
  onClearSelection: () => void
  busy: boolean
}) {
  return (
    <div className="flex items-center gap-3 rounded-sm border border-copper/30 bg-copper-soft px-3 py-2">
      <span className="text-[11px] uppercase tracking-wider text-copper">
        <span className="num tabular-nums">{selectedCount}</span> selected
      </span>
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onClearSelection}
          disabled={busy}
          className="text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          Clear
        </button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              disabled={busy}
              className="h-7 rounded-sm bg-copper px-2.5 text-[11px] uppercase tracking-wider text-background hover:bg-copper/90"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
              Archive {selectedCount}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Archive {selectedCount} {selectedCount === 1 ? "note" : "notes"}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Archived notes stop informing planning but are not deleted. You can restore them anytime from the
                Archived tab.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onBulkArchive}>Archive</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}

export function MemoryToolbar({
  search,
  onSearchChange,
  layer,
  onLayerChange,
  importance,
  onImportanceChange,
  category,
  onCategoryChange,
  categoryOptions,
  filtersActive,
  onResetFilters,
  onCreate,
  creating,
  selectedCount,
  onBulkArchive,
  onClearSelection,
  bulkBusy,
}: {
  search: string
  onSearchChange: (value: string) => void
  layer: MemoryLayer | "all"
  onLayerChange: (value: MemoryLayer | "all") => void
  importance: MemoryImportance | "all"
  onImportanceChange: (value: MemoryImportance | "all") => void
  category: string
  onCategoryChange: (value: string) => void
  categoryOptions: string[]
  filtersActive: boolean
  onResetFilters: () => void
  onCreate: (input: MemoryCreateInput) => Promise<boolean>
  creating: boolean
  selectedCount: number
  onBulkArchive: () => void
  onClearSelection: () => void
  bulkBusy: boolean
}) {
  const [addOpen, setAddOpen] = useState(false)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[11rem] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search notes"
            aria-label="Search memories"
            className="h-8 w-full rounded-sm border-rule pl-8 text-[12px]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={layer} onValueChange={(value) => onLayerChange(value as MemoryLayer | "all")}>
            <SelectTrigger size="sm" className={TRIGGER_CLASS} aria-label="Filter by layer">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-[12px]">
                All layers
              </SelectItem>
              {MEMORY_LAYER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value} className="text-[12px]">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={importance} onValueChange={(value) => onImportanceChange(value as MemoryImportance | "all")}>
            <SelectTrigger size="sm" className={cn(TRIGGER_CLASS, "min-w-[7rem]")} aria-label="Filter by importance">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-[12px]">
                All importance
              </SelectItem>
              {MEMORY_IMPORTANCE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value} className="text-[12px]">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {categoryOptions.length > 0 ? (
            <Select value={category} onValueChange={onCategoryChange}>
              <SelectTrigger size="sm" className={TRIGGER_CLASS} aria-label="Filter by category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-[12px]">
                  All categories
                </SelectItem>
                {categoryOptions.map((option) => (
                  <SelectItem key={option} value={option} className="text-[12px]">
                    {titleCase(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {filtersActive ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onResetFilters}
                  aria-label="Clear filters"
                  className="flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6} className="text-[11px]">
                Clear filters
              </TooltipContent>
            </Tooltip>
          ) : null}

          <Button
            size="sm"
            onClick={() => setAddOpen((open) => !open)}
            className={cn(
              "h-8 rounded-sm px-2.5 text-[11px] uppercase tracking-wider",
              addOpen
                ? "bg-copper-soft text-copper hover:bg-copper-soft"
                : "bg-copper text-background hover:bg-copper/90",
            )}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
            Add
          </Button>
        </div>
      </div>

      {addOpen ? <AddComposer onCreate={onCreate} onClose={() => setAddOpen(false)} busy={creating} /> : null}

      {selectedCount > 0 ? (
        <BulkBar
          selectedCount={selectedCount}
          onBulkArchive={onBulkArchive}
          onClearSelection={onClearSelection}
          busy={bulkBusy}
        />
      ) : null}
    </div>
  )
}
