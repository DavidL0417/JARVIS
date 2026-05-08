"use client"

import { useMemo, useState } from "react"
import { Check, Database, Loader2, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { SourceCandidate, SourceSnapshotSummary } from "@/types"

function formatDue(value: string | null) {
  if (!value) {
    return "No date"
  }

  return new Date(value).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

function confidenceLabel(value: number | null) {
  if (value === null) {
    return "—"
  }

  return `${Math.round(value * 100)}%`
}

function formatCapturedAt(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

async function readCandidateResponse(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null)

  if (!response.ok || !payload) {
    const message =
      payload && typeof payload === "object" && "details" in payload && typeof payload.details === "string"
        ? payload.details
        : payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : fallback

    throw new Error(message)
  }
}

export function ReviewLedgerPanel({
  candidates,
  sources,
  onCandidatesChanged,
}: {
  candidates: SourceCandidate[]
  sources: SourceSnapshotSummary[]
  onCandidatesChanged: () => Promise<void>
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState("")
  const pendingCandidates = useMemo(
    () => candidates.filter((candidate) => candidate.status === "pending").slice(0, 8),
    [candidates],
  )
  const recentSources = useMemo(
    () => sources.filter((source) => source.source !== "google_calendar").slice(0, 6),
    [sources],
  )

  async function mutateCandidate(candidateId: string, action: "approve" | "dismiss") {
    setBusyId(candidateId)
    setErrorMessage("")

    try {
      const response =
        action === "approve"
          ? await fetch("/api/sources/candidates/approve", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ candidateIds: [candidateId] }),
            })
          : await fetch("/api/sources/candidates", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ candidateIds: [candidateId], status: "dismissed" }),
            })

      await readCandidateResponse(response, `Failed to ${action} candidate.`)
      await onCandidatesChanged()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : `Failed to ${action} candidate.`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="flex flex-col gap-3 border-b border-rule pb-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold uppercase text-foreground">Context Inbox</h2>
        <Badge variant="outline" className="rounded-sm">
          {pendingCandidates.length + recentSources.length}
        </Badge>
      </div>

      {recentSources.length > 0 ? (
        <div className="flex flex-col gap-2">
          {recentSources.map((source) => (
            <div key={source.id} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2 rounded-sm bg-secondary/15 px-3 py-2.5 text-[12px]">
              <Database className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium capitalize text-foreground">{source.source.replace("_", " ")}</span>
                  <span className="num text-[10px] uppercase text-muted-foreground">
                    {formatCapturedAt(source.capturedAt)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-3 leading-5 text-muted-foreground">{source.summary}</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {pendingCandidates.length === 0 ? (
        <p className="text-[12px] leading-5 text-muted-foreground">
          No approval items waiting. Recent source scans still inform planning context.
        </p>
      ) : (
        <ScrollArea className="max-h-[320px] pr-3">
          <div className="flex flex-col gap-2">
            {pendingCandidates.map((candidate) => (
              <div key={candidate.id} className="rounded-sm border border-rule bg-secondary/15 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="rounded-sm">
                        {candidate.kind}
                      </Badge>
                      <span className="num text-[11px] text-muted-foreground">
                        {confidenceLabel(candidate.confidence)}
                      </span>
                    </div>
                    <h3 className="mt-2 line-clamp-2 text-[13px] font-medium leading-5 text-foreground">
                      {candidate.title}
                    </h3>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      {candidate.course ?? "Context"} · {formatDue(candidate.dueAt)}
                    </p>
                    {candidate.evidence ? (
                      <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-muted-foreground">
                        {candidate.evidence}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="icon"
                      variant="secondary"
                      aria-label="Approve candidate"
                      disabled={Boolean(busyId)}
                      onClick={() => void mutateCandidate(candidate.id, "approve")}
                    >
                      {busyId === candidate.id ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Dismiss candidate"
                      disabled={Boolean(busyId)}
                      onClick={() => void mutateCandidate(candidate.id, "dismiss")}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}

      {errorMessage ? (
        <p className="text-[12px] leading-5 text-destructive">{errorMessage}</p>
      ) : null}
    </section>
  )
}
