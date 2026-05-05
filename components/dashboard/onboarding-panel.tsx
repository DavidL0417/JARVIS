"use client"

import { useEffect, useMemo, useState } from "react"
import { CalendarDays, CheckCircle2, Loader2, RotateCcw, Sparkles, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { OnboardingRequest, OnboardingResponse } from "@/types"

const ONBOARDING_STORAGE_KEY = "jarvis:onboarding:v1"

type SubmitStatus = "idle" | "saving" | "error" | "success"

interface OnboardingPanelProps {
  isEmpty: boolean
  forceOpen: boolean
  onForceOpenChange: (open: boolean) => void
  onComplete: (options: { scheduleAfter: boolean }) => Promise<void> | void
}

function getDefaultTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago"
  } catch {
    return "America/Chicago"
  }
}

function toTaskLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function buildTaskInputs(value: string): OnboardingRequest["tasks"] {
  return toTaskLines(value).map((title) => ({
    title,
    deadline: null,
    durationMinutes: null,
    priority: "medium",
    status: "todo",
    isImmutable: false,
    allDay: false,
    calendarId: null,
    tags: ["setup"],
  }))
}

function readDismissed() {
  if (typeof window === "undefined") {
    return false
  }

  return window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === "dismissed"
}

export function OnboardingPanel({
  isEmpty,
  forceOpen,
  onForceOpenChange,
  onComplete,
}: OnboardingPanelProps) {
  const [dismissed, setDismissed] = useState(false)
  const [status, setStatus] = useState<SubmitStatus>("idle")
  const [errorMessage, setErrorMessage] = useState("")
  const [name, setName] = useState("David")
  const [timezone] = useState(getDefaultTimezone)
  const [workdayStart, setWorkdayStart] = useState("09:00")
  const [workdayEnd, setWorkdayEnd] = useState("17:00")
  const [peakEnergyWindow, setPeakEnergyWindow] = useState("")
  const [sleepPattern, setSleepPattern] = useState("")
  const [taskLines, setTaskLines] = useState("")

  useEffect(() => {
    setDismissed(readDismissed())
  }, [])

  const tasks = useMemo(() => buildTaskInputs(taskLines), [taskLines])
  const shouldShow = forceOpen || (!dismissed && isEmpty)

  const handleDismiss = () => {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "dismissed")
    setDismissed(true)
    onForceOpenChange(false)
  }

  const handleReplay = () => {
    window.localStorage.removeItem(ONBOARDING_STORAGE_KEY)
    setDismissed(false)
    onForceOpenChange(true)
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      setStatus("error")
      setErrorMessage("Please enter a name for this workspace.")
      return
    }

    setStatus("saving")
    setErrorMessage("")

    const requestBody: OnboardingRequest = {
      name: name.trim(),
      timezone,
      goals: [],
      tasks,
      preferences: {
        timezone,
        workdayStart,
        workdayEnd,
        peakEnergyWindow: peakEnergyWindow.trim() || null,
        sleepPattern: sleepPattern.trim() || null,
        defaultTaskDurationMinutes: 50,
        breakDurationMinutes: 10,
        preferredCheckInMode: "quiet",
      },
    }

    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      })
      const payload = (await response.json().catch(() => null)) as
        | (OnboardingResponse & { error?: string; details?: string })
        | null

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.details || payload?.error || "Failed to save setup.")
      }

      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "dismissed")
      setDismissed(true)
      setStatus("success")
      await onComplete({ scheduleAfter: tasks.length > 0 })
      onForceOpenChange(false)
    } catch (error) {
      setStatus("error")
      setErrorMessage(error instanceof Error ? error.message : "Failed to save setup.")
    }
  }

  if (!shouldShow) {
    return (
      <button
        type="button"
        onClick={handleReplay}
        className="flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-2">
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Replay setup guide
        </span>
        <span className="text-[10px] uppercase tracking-[0.16em]">Guide</span>
      </button>
    )
  }

  return (
    <section className="rounded-lg border border-primary/25 bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            <Sparkles className="size-3.5" aria-hidden="true" />
            First plan
          </p>
          <h2 className="mt-1 text-sm font-semibold text-foreground">Give JARVIS enough truth to plan.</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Add a few real constraints and tasks. JARVIS will save them, then generate a first schedule.
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Dismiss setup guide" onClick={handleDismiss}>
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="mt-4 grid gap-3">
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          Workspace name
          <Input value={name} onChange={(event) => setName(event.target.value)} className="h-8 text-sm" />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
            Work starts
            <Input
              type="time"
              value={workdayStart}
              onChange={(event) => setWorkdayStart(event.target.value)}
              className="h-8 text-sm"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
            Work ends
            <Input
              type="time"
              value={workdayEnd}
              onChange={(event) => setWorkdayEnd(event.target.value)}
              className="h-8 text-sm"
            />
          </label>
        </div>

        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          Peak energy
          <Input
            value={peakEnergyWindow}
            onChange={(event) => setPeakEnergyWindow(event.target.value)}
            placeholder="Example: 10 AM to 1 PM"
            className="h-8 text-sm"
          />
        </label>

        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          Sleep or no-work note
          <Input
            value={sleepPattern}
            onChange={(event) => setSleepPattern(event.target.value)}
            placeholder="Example: stop work by 11 PM"
            className="h-8 text-sm"
          />
        </label>

        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          Tasks, one per line
          <Textarea
            value={taskLines}
            onChange={(event) => setTaskLines(event.target.value)}
            placeholder={"Finish reading response\nPrepare entrepreneurship deck"}
            className="min-h-24 resize-none text-sm"
          />
        </label>

        {errorMessage ? (
          <p className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
            {errorMessage}
          </p>
        ) : null}

        {status === "success" ? (
          <p className="flex items-center gap-2 rounded-md border border-success/35 bg-success/10 px-3 py-2 text-xs text-foreground">
            <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
            Setup saved.
          </p>
        ) : null}

        <Button onClick={handleSubmit} disabled={status === "saving"} className="h-9 justify-center gap-2 text-sm">
          {status === "saving" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <CalendarDays className="size-4" aria-hidden="true" />
          )}
          Create first plan
        </Button>
      </div>
    </section>
  )
}
