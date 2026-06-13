"use client"

import { useState } from "react"
import type { ReactNode } from "react"
import { BookOpen, ChevronDown, Globe, ListChecks, Plus, Repeat } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

// A compact recreation of one Apple Shortcuts action row — icon chip + label, with
// an optional Key/Type/Value table for the Dictionary and URL-body steps. Styled to
// echo the Shortcuts editor so the guide reads as a faithful walkthrough.
function StepCard({
  index,
  icon: Icon,
  children,
  table,
}: {
  index: number
  icon: LucideIcon
  children: ReactNode
  table?: { columns: string[]; rows: string[][] }
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-sm border border-rule bg-secondary/15 px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <span className="num mt-0.5 w-3 shrink-0 text-[10px] font-semibold leading-5 text-muted-foreground/70">
          {index}
        </span>
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-copper/15 text-copper">
          <Icon className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
        </span>
        <p className="min-w-0 text-[12px] leading-5 text-foreground [overflow-wrap:anywhere]">{children}</p>
      </div>
      {table ? (
        <div className="ml-10 overflow-hidden rounded-[4px] border border-rule/70">
          <div className="grid grid-cols-[1fr_3.5rem_1fr] bg-secondary/25 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
            {table.columns.map((column) => (
              <span key={column} className="border-b border-rule/60 px-2 py-1">
                {column}
              </span>
            ))}
          </div>
          {table.rows.map((row, rowIndex) => (
            <div key={row[0]} className="grid grid-cols-[1fr_3.5rem_1fr] text-[11px] text-foreground">
              {row.map((cell, cellIndex) => (
                <span
                  key={`${row[0]}-${table.columns[cellIndex]}`}
                  className={cn(
                    "px-2 py-1 [overflow-wrap:anywhere]",
                    rowIndex < table.rows.length - 1 && "border-b border-rule/40",
                    cellIndex === 1 && "text-muted-foreground",
                    cellIndex === 2 && "text-copper",
                  )}
                >
                  {cell}
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// Collapsible "what's inside the Shortcut" guide shown under step 3 of the Apple
// Reminders source panel. Most users just install the pre-built Shortcut; this is
// for verifying or rebuilding it by hand.
export function AppleRemindersShortcutGuide() {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-sm border border-rule">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-secondary/15"
        aria-expanded={open}
      >
        <ListChecks className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        <span className="text-[12px] font-medium text-foreground">What&apos;s inside the Shortcut (build or verify it)</span>
        <ChevronDown
          className={cn(
            "ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            !open && "-rotate-90",
          )}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div className="flex min-w-0 flex-col gap-3 border-t border-rule px-3 py-4">
          <p className="text-[11px] leading-5 text-muted-foreground">
            Add Shortcut above installs this already-built — you don&apos;t have to make it. Open it in Apple
            Shortcuts to check it matches, or rebuild it from these six actions. Only the Authorization header
            needs your token; everything else is fixed.
          </p>

          <div className="flex flex-col gap-2">
            <StepCard index={1} icon={ListChecks}>
              <strong className="font-semibold text-foreground">Find Reminders</strong> where{" "}
              <strong className="font-semibold text-foreground">Is Not Completed</strong> — grabs your open reminders.
            </StepCard>

            <StepCard index={2} icon={Repeat}>
              <strong className="font-semibold text-foreground">Repeat with each item in</strong> Reminders — it picks
              up the list automatically.
            </StepCard>

            <StepCard
              index={3}
              icon={BookOpen}
              table={{
                columns: ["Key", "Type", "Value"],
                rows: [
                  ["title", "Text", "Repeat Item"],
                  ["notes", "Text", "Notes"],
                  ["dueDate", "Text", "Due Date"],
                  ["priority", "Text", "Priority"],
                  ["list", "Text", "List"],
                ],
              }}
            >
              <strong className="font-semibold text-foreground">Dictionary</strong> — five Text keys. For each Value,
              insert the <strong className="font-semibold text-foreground">Repeat Item</strong> variable, then tap it to
              pick the property shown.
            </StepCard>

            <StepCard index={4} icon={Plus}>
              <strong className="font-semibold text-foreground">Add to Variable</strong> — add the Dictionary to a
              variable named <strong className="font-semibold text-foreground">Items</strong>.
            </StepCard>

            <StepCard index={5} icon={Repeat}>
              <strong className="font-semibold text-foreground">End Repeat</strong>.
            </StepCard>

            <StepCard
              index={6}
              icon={Globe}
              table={{
                columns: ["Key", "Type", "Value"],
                rows: [["reminders", "Text", "Items"]],
              }}
            >
              <strong className="font-semibold text-foreground">Get Contents of URL</strong> — Method{" "}
              <strong className="font-semibold text-foreground">POST</strong>, Header{" "}
              <strong className="font-semibold text-foreground">Authorization</strong> ={" "}
              <code className="rounded bg-secondary/40 px-1 text-[10px]">Bearer your-token</code>, Request Body{" "}
              <strong className="font-semibold text-foreground">JSON</strong>:
            </StepCard>
          </div>
        </div>
      ) : null}
    </div>
  )
}
