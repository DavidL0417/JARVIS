"use client"

import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * The single section grammar for the dashboard rails and drawers.
 *
 * One header contract (eyebrow title · optional copper icon · optional mono
 * count · one action slot), one divider (`border-b border-rule`), one internal
 * rhythm (`gap-3`). No background fills, no rounded cards — emphasis comes from
 * the rule and the copper accent only. The containing rail/list zeroes the last
 * divider via `[&>*:last-child]:border-b-0 [&>*:last-child]:pb-0`.
 */
export function RailSection({
  title,
  icon: Icon,
  count,
  action,
  children,
  className,
}: {
  title: string
  icon?: LucideIcon
  count?: number | string
  action?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <section className={cn("flex flex-col gap-3 border-b border-rule pb-5", className)}>
      <div className="flex h-7 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 text-copper" aria-hidden="true" strokeWidth={1.75} /> : null}
          <h2 className="eyebrow truncate">{title}</h2>
          {count !== undefined ? (
            <span className="num text-[11px] font-medium text-muted-foreground">{count}</span>
          ) : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-1.5">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}
