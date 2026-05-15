"use client"

import type { ReactNode } from "react"
import { useEffect } from "react"
import { X } from "lucide-react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export function RailSheet({
  isOpen,
  onClose,
  title,
  width = 380,
  children,
}: {
  isOpen: boolean
  onClose: () => void
  title: string
  width?: number
  children: ReactNode
}) {
  useEffect(() => {
    if (!isOpen) return

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose()
      }
    }

    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [isOpen, onClose])

  if (!isOpen) {
    return null
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-background/60 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className="fixed left-0 top-0 z-50 h-full max-w-full border-r border-rule bg-background animate-in slide-in-from-left duration-200"
        style={{ width: `min(${width}px, 100vw)` }}
        aria-label={title}
      >
        <div className="flex h-full flex-col">
          <header className="flex h-12 shrink-0 items-center justify-between border-b border-rule px-4">
            <h2 className="eyebrow">{title}</h2>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6} className="text-[11px]">
                Close · Esc
              </TooltipContent>
            </Tooltip>
          </header>

          <div className="rail-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        </div>
      </aside>
    </>
  )
}
