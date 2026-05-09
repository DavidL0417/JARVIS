"use client"

import { useMemo, useState } from "react"
import { CalendarDays, Check, Database, Loader2, X } from "lucide-react"

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

function formatCalendarDay(value: string) {
  const date = new Date(`${value}T12:00:00`)

  return {
    day: date.toLocaleDateString([], { day: "2-digit" }),
    weekday: date.toLocaleDateString([], { weekday: "short" }),
    month: date.toLocaleDateString([], { month: "short" }),
  }
}

function localDateKey(value: string) {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")

  return `${year}-${month}-${day}`
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

function latestSourcePerKind(sources: SourceSnapshotSummary[]) {
  const seen = new Set<string>()
  const latest: SourceSnapshotSummary[] = []

  for (const source of sources) {
    if (source.source === "google_calendar" || seen.has(source.source)) {
      continue
    }

    seen.add(source.source)
    latest.push(source)
  }

  return latest
}

function CandidateActions({
  candidate,
  busyId,
  onAction,
}: {
  candidate: SourceCandidate
  busyId: string | null
  onAction: (candidateId: string, action: "approve" | "dismiss") => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        size="icon"
        variant="ghost"
        aria-label="Approve candidate"
        disabled={Boolean(busyId)}
        onClick={() => onAction(candidate.id, "approve")}
        className="size-7 rounded-sm"
      >
        {busyId === candidate.id ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Dismiss candidate"
        disabled={Boolean(busyId)}
        onClick={() => onAction(candidate.id, "dismiss")}
        className="size-7 rounded-sm"
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  )
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
    () => candidates.filter((candidate) => candidate.status === "pending"),
    [candidates],
  )
  const datedCandidates = useMemo(
    () =>
      pendingCandidates
        .filter((candidate) => candidate.dueAt)
        .sort((left, right) => new Date(left.dueAt || 0).getTime() - new Date(right.dueAt || 0).getTime())
        .slice(0, 12),
    [pendingCandidates],
  )
  const undatedCandidates = useMemo(
    () => pendingCandidates.filter((candidate) => !candidate.dueAt).slice(0, 5),
    [pendingCandidates],
  )
  const candidatesByDay = useMemo(() => {
    const groups = new Map<string, SourceCandidate[]>()

    for (const candidate of datedCandidates) {
      const key = localDateKey(candidate.dueAt || "")
      groups.set(key, [...(groups.get(key) || []), candidate])
    }

    return Array.from(groups.entries())
  }, [datedCandidates])
  const recentSources = useMemo(
    () => latestSourcePerKind(sources).slice(0, 3),
    [sources],
  )
  const failedSourceCount = sources.filter((source) => source.source !== "google_calendar" && source.freshness === "failed").length

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
          {pendingCandidates.length}
        </Badge>
      </div>

      {failedSourceCount > 0 ? (
        <p className="text-[12px] leading-5 text-destructive">
          {failedSourceCount} source refresh issue{failedSourceCount === 1 ? "" : "s"} need attention.
        </p>
      ) : null}

      {pendingCandidates.length === 0 && recentSources.length > 0 ? (
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
        <ScrollArea className="max-h-[430px] pr-3">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-[12px] font-medium uppercase text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5 text-copper" aria-hidden="true" />
              Deadline Review
            </div>
            {candidatesByDay.length > 0 ? (
              <div className="rounded-sm border border-rule">
                {candidatesByDay.map(([dayKey, dayCandidates]) => {
                  const day = formatCalendarDay(dayKey)

                  return (
                    <div key={dayKey} className="grid grid-cols-[3.75rem_minmax(0,1fr)] border-b border-rule last:border-b-0">
                      <div className="border-r border-rule px-2 py-2 text-center">
                        <div className="num text-[18px] font-semibold leading-none text-foreground">{day.day}</div>
                        <div className="mt-1 text-[10px] uppercase text-muted-foreground">{day.weekday}</div>
                        <div className="text-[10px] uppercase text-muted-foreground">{day.month}</div>
                      </div>
                      <div className="min-w-0 divide-y divide-rule">
                        {dayCandidates.map((candidate) => (
                          <div key={candidate.id} className="flex min-w-0 items-center justify-between gap-2 px-3 py-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="line-clamp-1 text-[12px] font-medium text-foreground">{candidate.title}</span>
                                <span className="num shrink-0 text-[10px] text-muted-foreground">{confidenceLabel(candidate.confidence)}</span>
                              </div>
                              <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                                {candidate.course ?? candidate.kind} · {formatDue(candidate.dueAt)}
                              </p>
                            </div>
                            <CandidateActions
                              candidate={candidate}
                              busyId={busyId}
                              onAction={(candidateId, action) => void mutateCandidate(candidateId, action)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}

            {undatedCandidates.length > 0 ? (
              <div className="rounded-sm border border-rule">
                <div className="border-b border-rule px-3 py-2 text-[11px] font-medium uppercase text-muted-foreground">
                  Needs Date
                </div>
                <div className="divide-y divide-rule">
                  {undatedCandidates.map((candidate) => (
                    <div key={candidate.id} className="flex min-w-0 items-center justify-between gap-2 px-3 py-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="line-clamp-1 text-[12px] font-medium text-foreground">{candidate.title}</span>
                          <span className="num shrink-0 text-[10px] text-muted-foreground">{confidenceLabel(candidate.confidence)}</span>
                        </div>
                        <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                          {candidate.course ?? candidate.kind} · no date
                        </p>
                      </div>
                      <CandidateActions
                        candidate={candidate}
                        busyId={busyId}
                        onAction={(candidateId, action) => void mutateCandidate(candidateId, action)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {pendingCandidates.length > datedCandidates.length + undatedCandidates.length ? (
              <p className="text-[11px] leading-5 text-muted-foreground">
                {pendingCandidates.length - datedCandidates.length - undatedCandidates.length} more items are waiting off-screen.
              </p>
            ) : null}
          </div>
        </ScrollArea>
      )}

      {errorMessage ? (
        <p className="text-[12px] leading-5 text-destructive">{errorMessage}</p>
      ) : null}
    </section>
  )
}
