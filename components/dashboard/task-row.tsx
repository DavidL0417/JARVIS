"use client"

import { useRef, useState, type ReactNode } from "react"
import { Check, Loader2 } from "lucide-react"

import { fireConfetti } from "@/components/dashboard/confetti"

// Shared row skeleton for the task surfaces (rail + pane). It owns the <li>
// wrapper, the title clamp, and the reveal-on-hover action cluster; everything
// that drifts per surface — the leading control, the meta line, the trailing
// actions, and the few style classes that differ — is passed in.
const DEFAULT_ROW_CLASS =
  "group flex items-start gap-2.5 rounded-sm px-2 py-[7px] transition-colors hover:bg-muted/20"

interface TaskRowProps {
  // Leading control(s): a completion checkbox, a restore button, an index, etc.
  leading: ReactNode
  title: string
  // Tailwind color/decoration classes for the title (completed → line-through, …).
  titleClassName?: string
  // When this prop is passed (even as null), the title is laid out in a
  // space-between row with the node pinned to its right (the inline deadline
  // pill). Omit it entirely for a plain, full-width title.
  titleAside?: ReactNode
  // Meta line rendered under the title; callers pass null to omit it.
  meta?: ReactNode
  // Trailing hover actions, wrapped in the standard reveal-on-hover cluster.
  actions?: ReactNode
  // Overrides the <li> classes when a call site needs different row styling.
  className?: string
  // A mutation (delete/unschedule) is in flight: dim the row and swallow input
  // so the click reads as acknowledged until the row is removed or restored.
  pending?: boolean
}

export function TaskRow(props: TaskRowProps) {
  const { leading, title, titleClassName = "text-foreground", meta, actions, className, pending } = props
  // Presence of the prop — not its runtime value — opts into the split title row,
  // so a deadline-less task keeps the same wrapper as one with a pill.
  const hasAside = "titleAside" in props

  const titleEl = <p className={`line-clamp-2 text-[13px] leading-snug ${titleClassName}`}>{title}</p>

  return (
    <li
      className={`${className ?? DEFAULT_ROW_CLASS}${pending ? " pointer-events-none opacity-50" : ""}`}
      aria-busy={pending || undefined}
    >
      {leading}
      <div className="min-w-0 flex-1">
        {hasAside ? (
          <div className="flex items-start justify-between gap-2.5">
            {titleEl}
            {props.titleAside}
          </div>
        ) : (
          titleEl
        )}
        {meta}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {actions}
        </div>
      ) : null}
    </li>
  )
}

interface TaskCheckboxProps {
  checked: boolean
  // May be async: while the toggle is in flight we spin so the click reads as
  // acknowledged across the mutation + dashboard-reload round-trip.
  onToggle: () => Promise<void> | void
  // Layout/shape classes that differ per surface (top margin, corner radius).
  className?: string
  // Border treatment for the unchecked state (hover color differs per surface).
  uncheckedClassName?: string
}

export function TaskCheckbox({
  checked,
  onToggle,
  className = "",
  uncheckedClassName = "border-rule-strong hover:border-foreground",
}: TaskCheckboxProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)

  const handleClick = async () => {
    if (busy) return
    // Fire the celebration only when completing — and from the box's own center,
    // before the await, so it originates right where the user clicked even if the
    // row vanishes a moment later.
    if (!checked) {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (rect) {
        fireConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2)
      }
    }

    setBusy(true)
    try {
      await onToggle()
    } finally {
      // Harmless no-op if the row already unmounted on reload.
      setBusy(false)
    }
  }

  // Show the filled (copper) treatment the instant work starts, so completing a
  // task reads as done immediately rather than after the server round-trip.
  const filled = checked || busy

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => void handleClick()}
      disabled={busy}
      aria-busy={busy || undefined}
      aria-label={checked ? "Mark todo" : "Mark complete"}
      className={`flex h-4 w-4 shrink-0 items-center justify-center border transition-colors ${className} ${
        filled ? "border-copper bg-copper text-primary-foreground" : uncheckedClassName
      }`}
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={3} />
      ) : checked ? (
        <Check className="h-3 w-3" strokeWidth={3} />
      ) : null}
    </button>
  )
}
