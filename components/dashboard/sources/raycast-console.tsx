"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

import {
  DetailHeader,
  InfoLine,
  InlineError,
  LedgerStrip,
  type ConnectorDefinition,
  type ConnectorState,
} from "@/components/dashboard/sources/shared"

interface RaycastStatus {
  lastCapturedAt: string | null
  summary?: string
  noteCount?: number
  openTasks?: number
  doneTasks?: number
  bullets?: number
}

function relativeTime(iso: string | null): string {
  if (!iso) {
    return ""
  }
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) {
    return ""
  }
  const minutes = Math.floor((Date.now() - then) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return "yesterday"
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

// Operator-only, READ-ONLY status card for the hidden Raycast Notes intake. There is
// nothing to configure: a reader on the operator's Mac decrypts Raycast Notes and POSTs
// snapshots to the bearer-gated ingest route. This pane just proves the intake is alive
// — last-fed time + digest counts — by reading the 404-gated /status route. Only rendered
// for the operator. See docs/decisions/operator-only-raycast.md.
export function RaycastConsolePane({
  connector,
  state,
}: {
  connector: ConnectorDefinition
  state: ConnectorState
}) {
  const [status, setStatus] = useState<RaycastStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const response = await fetch("/api/integrations/raycast/status")
      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? "Raycast intake is not enabled for this account."
            : "Failed to read Raycast status.",
        )
      }
      const data = (await response.json().catch(() => null)) as RaycastStatus | null
      setStatus(data ?? { lastCapturedAt: null })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to read Raycast status.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const lastFed = status?.lastCapturedAt ? relativeTime(status.lastCapturedAt) : null
  const isLive = Boolean(status?.lastCapturedAt)

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <DetailHeader connector={connector} state={state} />
      <p className="max-w-[60ch] text-[12px] leading-5 text-muted-foreground">
        A reader on your Mac decrypts your Raycast Notes scratchpad and mirrors it into JARVIS as ambient context —
        one-way and read-only. Nothing here becomes a task: the assistant can reference what you jotted down without
        your half-formed bullets turning into commitments. There is nothing to configure; this is the operator-only
        intake, on request.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-[12px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-copper" aria-hidden="true" /> Loading…
        </div>
      ) : status ? (
        <>
          {isLive ? (
            <LedgerStrip
              items={[
                { label: "Notes", value: status.noteCount ?? 0 },
                { label: "Open tasks", value: status.openTasks ?? 0 },
                { label: "Done", value: status.doneTasks ?? 0 },
                { label: "Bullets", value: status.bullets ?? 0 },
              ]}
            />
          ) : null}

          {isLive && status.summary ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Latest digest</span>
              <p className="whitespace-pre-line text-[12px] leading-5 text-foreground/80 [overflow-wrap:anywhere]">
                {status.summary}
              </p>
            </div>
          ) : null}

          {!isLive ? (
            <p className="py-2 text-[12px] text-muted-foreground">
              No snapshot has landed yet. The reader writes the first one the next time it runs.
            </p>
          ) : null}

          <div className="flex flex-col">
            <InfoLine label="Status" value={isLive ? `Live · last fed ${lastFed}` : "Configured · awaiting first snapshot"} />
            <InfoLine label="Direction" value="Mac to JARVIS (one-way, read-only)" />
            <InfoLine label="Extraction" value="None — context only, never tasks" />
            <InfoLine label="Sync" value="3×/day via local launchd reader" />
          </div>
        </>
      ) : null}

      <InlineError message={error} />
    </div>
  )
}
