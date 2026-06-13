"use client"

import { useState } from "react"
import { ChevronDown, Download } from "lucide-react"

import { cn } from "@/lib/utils"

const APPLE_REMINDERS_INGEST_URL = "https://mydearestjarvis.vercel.app/api/integrations/apple-reminders/ingest"

// A faithful recreation of the ONE action the user has to touch in the installed
// Shortcut: the final "Get Contents of URL" step, expanded, with the Authorization
// header highlighted. The five upstream actions ship pre-configured, so they're
// not reproduced here — only what needs the user's token is shown.
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
        <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        <span className="text-[12px] font-medium text-foreground">Show me exactly where to paste the token</span>
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
            The Shortcut is already built. Open it in Apple Shortcuts and scroll to the last action,{" "}
            <strong className="font-semibold text-foreground">Get Contents of URL</strong>. The only thing you change is
            the <strong className="font-semibold text-foreground">Authorization</strong> header. It should look exactly
            like this:
          </p>

          {/* Replica of the expanded "Get Contents of URL" action */}
          <div className="flex min-w-0 flex-col overflow-hidden rounded-sm border border-rule bg-secondary/15">
            <div className="flex items-start gap-2.5 px-3 py-2.5">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] bg-emerald-500/15 text-emerald-300">
                <Download className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
              </span>
              <p className="min-w-0 text-[12px] leading-5 text-foreground">
                Get contents of{" "}
                <span className="text-copper [overflow-wrap:anywhere]">{APPLE_REMINDERS_INGEST_URL}</span>
              </p>
            </div>

            <div className="flex flex-col gap-3 border-t border-rule/60 px-3 py-3">
              <div className="flex items-center gap-2 text-[12px]">
                <span className="text-muted-foreground">Method</span>
                <span className="rounded-[4px] border border-rule bg-secondary/40 px-2 py-0.5 text-[11px] font-medium text-foreground">
                  POST
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] text-foreground">Headers</span>
                <div className="overflow-hidden rounded-[4px] border border-rule/70">
                  <div className="grid grid-cols-[1fr_1.6fr] bg-secondary/25 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                    <span className="border-b border-rule/60 px-2 py-1">Key</span>
                    <span className="border-b border-rule/60 px-2 py-1">Value</span>
                  </div>
                  <div className="grid grid-cols-[1fr_1.6fr] bg-copper/10 text-[11px]">
                    <span className="px-2 py-1.5 text-foreground">Authorization</span>
                    <span className="px-2 py-1.5 [overflow-wrap:anywhere]">
                      <span className="text-foreground">Bearer </span>
                      <span className="text-copper">your-token</span>
                    </span>
                  </div>
                </div>
                <p className="text-[10px] leading-4 text-copper [overflow-wrap:anywhere]">
                  Tap this value, clear it, and paste what you copied above — it already includes the word
                  &quot;Bearer&quot;.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-[12px]">
                  <span className="text-muted-foreground">Request Body</span>
                  <span className="rounded-[4px] border border-rule bg-secondary/40 px-2 py-0.5 text-[11px] font-medium text-foreground">
                    JSON
                  </span>
                </div>
                <div className="overflow-hidden rounded-[4px] border border-rule/70">
                  <div className="grid grid-cols-[1fr_52px_1fr] bg-secondary/25 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                    <span className="border-b border-rule/60 px-2 py-1">Key</span>
                    <span className="border-b border-rule/60 px-2 py-1">Type</span>
                    <span className="border-b border-rule/60 px-2 py-1">Value</span>
                  </div>
                  <div className="grid grid-cols-[1fr_52px_1fr] text-[11px]">
                    <span className="px-2 py-1.5 text-foreground">reminders</span>
                    <span className="px-2 py-1.5 text-muted-foreground">Text</span>
                    <span className="px-2 py-1.5 text-copper">Items</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <p className="text-[10px] leading-4 text-muted-foreground">
            Everything above this action — Find Reminders, Repeat, Dictionary, Add to Variable — comes pre-configured.
            Leave it as-is.
          </p>
        </div>
      ) : null}
    </div>
  )
}
