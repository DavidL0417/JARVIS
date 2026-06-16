"use client"

import { useState } from "react"
import { Loader2, Pencil, RotateCcw, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  ImportancePicker,
  formatRelative,
  importanceLabel,
  importanceTone,
  titleCase,
} from "@/components/dashboard/memory-shared"
import { cn } from "@/lib/utils"
import type { MemoryImportance, MemoryItemDetail } from "@/types"

export interface MemoryRowHandlers {
  onSave: (id: string, patch: { insight?: string; importance?: MemoryImportance }) => Promise<boolean>
  onArchive: (id: string) => Promise<boolean>
  onRestore: (id: string) => Promise<boolean>
}

function IconAction({
  label,
  onClick,
  disabled,
  icon: Icon,
  tone = "default",
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  icon: typeof Pencil
  tone?: "default" | "destructive" | "copper"
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground/70 transition-colors hover:bg-accent disabled:opacity-40",
            tone === "destructive" && "hover:text-destructive",
            tone === "copper" && "hover:text-copper",
            tone === "default" && "hover:text-foreground",
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={1.75} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="text-[11px]">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function MemoryRow({
  entry,
  selectable,
  selected,
  onToggleSelect,
  onSave,
  onArchive,
  onRestore,
  busy,
}: {
  entry: MemoryItemDetail
  selectable: boolean
  selected: boolean
  onToggleSelect: (id: string) => void
  busy: boolean
} & MemoryRowHandlers) {
  const [isEditing, setIsEditing] = useState(false)
  const [draftText, setDraftText] = useState(entry.insight)
  const [draftImportance, setDraftImportance] = useState<MemoryImportance>(entry.importance)

  const isArchived = entry.status === "archived"
  const canRestore = entry.status === "archived" || entry.status === "superseded"
  const canArchive = entry.status !== "archived"

  function startEditing() {
    setDraftText(entry.insight)
    setDraftImportance(entry.importance)
    setIsEditing(true)
  }

  function cancelEditing() {
    setIsEditing(false)
    setDraftText(entry.insight)
    setDraftImportance(entry.importance)
  }

  async function commit() {
    const trimmed = draftText.trim()
    if (!trimmed) {
      return
    }

    const patch: { insight?: string; importance?: MemoryImportance } = {}
    if (trimmed !== entry.insight) {
      patch.insight = trimmed
    }
    if (draftImportance !== entry.importance) {
      patch.importance = draftImportance
    }

    if (!patch.insight && !patch.importance) {
      setIsEditing(false)
      return
    }

    const ok = await onSave(entry.id, patch)
    if (ok) {
      setIsEditing(false)
    }
  }

  // Escape cancels the edit locally so it never bubbles up to close the workbench view.
  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.stopPropagation()
      cancelEditing()
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void commit()
    }
  }

  return (
    <article
      className={cn(
        "group/row flex gap-3 border-b border-rule/60 py-3 transition-colors last:border-b-0",
        isEditing && "bg-secondary/15 ring-1 ring-copper/30",
        isArchived && !isEditing && "opacity-70",
      )}
    >
      {selectable && !isEditing ? (
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect(entry.id)}
          disabled={busy}
          aria-label="Select memory"
          className="mt-0.5 shrink-0"
        />
      ) : null}

      <div className="min-w-0 flex-1">
        {isEditing ? (
          <div className="flex flex-col gap-3">
            <Textarea
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
              onKeyDown={handleKeyDown}
              rows={4}
              autoFocus
              className="min-h-[88px] resize-y border-rule bg-background/60 text-[13px] leading-6 text-foreground focus-visible:ring-copper/40"
              placeholder="Describe what JARVIS should remember…"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <ImportancePicker value={draftImportance} onChange={setDraftImportance} disabled={busy} />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={cancelEditing}
                  disabled={busy}
                  className="h-7 rounded-sm px-2.5 text-[11px] uppercase tracking-wider"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => void commit()}
                  disabled={busy || !draftText.trim()}
                  className="h-7 rounded-sm bg-copper px-2.5 text-[11px] uppercase tracking-wider text-background hover:bg-copper/90"
                >
                  {busy ? (
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
          <div className="flex flex-col gap-1.5">
            <p className="text-[13px] leading-6 text-foreground [overflow-wrap:anywhere]">{entry.insight}</p>
            <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span
                className={cn("inline-block h-1.5 w-1.5 rounded-full", importanceTone(entry.importance))}
                aria-hidden="true"
              />
              <span className={cn(entry.importance === "critical" && "text-copper")}>
                {importanceLabel(entry.importance)}
              </span>
              <span aria-hidden="true">·</span>
              <span>{titleCase(entry.category)}</span>
              <span aria-hidden="true">·</span>
              <span className="num">{formatRelative(entry.updatedAt)}</span>
              {entry.source ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{entry.source.replace(/_/g, " ")}</span>
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {!isEditing ? (
        <div className="flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
          {busy ? (
            <span className="flex h-7 w-7 items-center justify-center">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-copper" aria-hidden="true" />
            </span>
          ) : (
            <>
              <IconAction label="Edit" icon={Pencil} onClick={startEditing} tone="copper" />
              {canRestore ? (
                <IconAction label="Restore" icon={RotateCcw} onClick={() => void onRestore(entry.id)} tone="copper" />
              ) : null}
              {canArchive ? (
                <IconAction label="Archive" icon={Trash2} onClick={() => void onArchive(entry.id)} tone="destructive" />
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </article>
  )
}
