"use client"

import { useEffect, useMemo, useState } from "react"
import { CalendarClock, Clock, History, Loader2, Pause, SlidersHorizontal } from "lucide-react"

import { RailSection } from "@/components/dashboard/rail-section"
import { Switch } from "@/components/ui/switch"
import type { AutomationRunSummary } from "@/lib/automation-runs"

const CHECK_IN_MODES = ["silent", "quiet", "gentle", "active"] as const

interface PreferencesShape {
  timezone: string
  workdayStart: string
  workdayEnd: string
  defaultTaskDurationMinutes: number
  breakDurationMinutes: number
  preferredFocusBlockMinutes: number | null
  preferredCheckInMode: (typeof CHECK_IN_MODES)[number]
}

function deviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

function timezoneOptions(current: string) {
  let zones: string[] = []
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf
    if (supported) {
      zones = supported("timeZone")
    }
  } catch {
    zones = []
  }
  if (zones.length === 0) {
    zones = [
      "America/Chicago",
      "America/New_York",
      "America/Denver",
      "America/Los_Angeles",
      "Europe/London",
      "Europe/Berlin",
      "Asia/Tokyo",
      "UTC",
    ]
  }
  const device = deviceTimezone()
  const set = new Set([device, current, ...zones])
  return Array.from(set)
}

function runStatusLabel(status: AutomationRunSummary["status"]) {
  if (status === "completed") return "Ran"
  if (status === "skipped_paused") return "Paused"
  if (status === "skipped_idle") return "Idle"
  return "Failed"
}

function runStatusTone(status: AutomationRunSummary["status"]) {
  if (status === "completed") return "text-emerald-300"
  if (status === "failed") return "text-destructive"
  return "text-muted-foreground"
}

function formatRunTime(iso: string) {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return iso
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

const SELECT_CLASS =
  "h-8 w-full rounded-sm border border-rule bg-background px-2 text-[12px] text-foreground focus-visible:border-rule-strong focus-visible:outline-none"
const INPUT_CLASS =
  "h-8 w-full rounded-sm border border-rule bg-background px-2 text-[12px] text-foreground focus-visible:border-rule-strong focus-visible:outline-none"
const LABEL_CLASS = "text-[11px] font-medium text-muted-foreground"

export function SettingsPanel({ onChanged }: { onChanged?: () => void }) {
  const [preferences, setPreferences] = useState<PreferencesShape | null>(null)
  const [paused, setPaused] = useState(false)
  const [pausedUntil, setPausedUntil] = useState<string | null>(null)
  const [runs, setRuns] = useState<AutomationRunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [savingField, setSavingField] = useState<string | null>(null)
  const [error, setError] = useState("")

  const tzOptions = useMemo(() => timezoneOptions(preferences?.timezone ?? deviceTimezone()), [preferences?.timezone])

  async function load() {
    setLoading(true)
    setError("")
    try {
      const [prefRes, statusRes] = await Promise.all([
        fetch("/api/preferences"),
        fetch("/api/automation-status"),
      ])
      const prefPayload = await prefRes.json().catch(() => null)
      const statusPayload = await statusRes.json().catch(() => null)

      if (prefPayload?.preferences) {
        const p = prefPayload.preferences
        setPreferences({
          timezone: p.timezone,
          workdayStart: p.workdayStart,
          workdayEnd: p.workdayEnd,
          defaultTaskDurationMinutes: p.defaultTaskDurationMinutes,
          breakDurationMinutes: p.breakDurationMinutes,
          preferredFocusBlockMinutes: p.preferredFocusBlockMinutes,
          preferredCheckInMode: p.preferredCheckInMode,
        })
      }
      if (statusPayload && typeof statusPayload.paused === "boolean") {
        setPaused(statusPayload.paused)
        setPausedUntil(statusPayload.pausedUntil ?? null)
        setRuns(Array.isArray(statusPayload.lastRuns) ? statusPayload.lastRuns : [])
      }
    } catch {
      setError("Could not load settings.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function savePreference(field: keyof PreferencesShape, value: string | number | null) {
    if (!preferences) return
    setSavingField(field)
    setError("")
    setPreferences({ ...preferences, [field]: value } as PreferencesShape)
    try {
      const response = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      })
      if (!response.ok) {
        throw new Error("save failed")
      }
      onChanged?.()
    } catch {
      setError("Could not save that change.")
    } finally {
      setSavingField(null)
    }
  }

  async function setPause(next: boolean, until: string | null = null) {
    setSavingField("paused")
    setError("")
    setPaused(next)
    setPausedUntil(next ? until : null)
    try {
      const response = await fetch("/api/automation-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: next, pausedUntil: next ? until : null }),
      })
      if (!response.ok) {
        throw new Error("save failed")
      }
      onChanged?.()
    } catch {
      setError("Could not update pause state.")
    } finally {
      setSavingField(null)
    }
  }

  if (loading || !preferences) {
    return (
      <div className="flex items-center gap-2 py-6 text-[12px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Loading settings…
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-5 [&>*:last-child]:border-b-0 [&>*:last-child]:pb-0">
      {error ? <p className="text-[12px] text-destructive">{error}</p> : null}

      <RailSection title="Time" icon={Clock}>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL_CLASS}>Timezone</span>
          <select
            className={SELECT_CLASS}
            value={preferences.timezone}
            onChange={(event) => void savePreference("timezone", event.target.value)}
          >
            {tzOptions.map((zone) => (
              <option key={zone} value={zone}>
                {zone === deviceTimezone() ? `${zone} (device)` : zone}
              </option>
            ))}
          </select>
        </label>
      </RailSection>

      <RailSection title="Planning" icon={SlidersHorizontal}>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Workday start</span>
            <input
              type="time"
              className={INPUT_CLASS}
              value={preferences.workdayStart}
              onChange={(event) => void savePreference("workdayStart", event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Workday end</span>
            <input
              type="time"
              className={INPUT_CLASS}
              value={preferences.workdayEnd}
              onChange={(event) => void savePreference("workdayEnd", event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Default duration (min)</span>
            <input
              type="number"
              min={5}
              className={INPUT_CLASS}
              value={preferences.defaultTaskDurationMinutes}
              onChange={(event) => void savePreference("defaultTaskDurationMinutes", Number(event.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Break (min)</span>
            <input
              type="number"
              min={0}
              className={INPUT_CLASS}
              value={preferences.breakDurationMinutes}
              onChange={(event) => void savePreference("breakDurationMinutes", Number(event.target.value))}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL_CLASS}>Check-in mode</span>
          <select
            className={SELECT_CLASS}
            value={preferences.preferredCheckInMode}
            onChange={(event) => void savePreference("preferredCheckInMode", event.target.value)}
          >
            {CHECK_IN_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
      </RailSection>

      <RailSection title="Automations" icon={Pause}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-foreground">Pause background updates</p>
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              Stops the daily refresh cron and the local scheduled tasks. Building a plan by hand still works.
            </p>
          </div>
          <Switch
            checked={paused}
            disabled={savingField === "paused"}
            onCheckedChange={(checked) => void setPause(checked)}
            aria-label="Pause automations"
          />
        </div>
        {paused ? (
          <label className="flex flex-col gap-1.5">
            <span className={LABEL_CLASS}>Auto-resume on (optional)</span>
            <input
              type="datetime-local"
              className={INPUT_CLASS}
              value={pausedUntil ? pausedUntil.slice(0, 16) : ""}
              onChange={(event) =>
                void setPause(true, event.target.value ? new Date(event.target.value).toISOString() : null)
              }
            />
          </label>
        ) : null}
      </RailSection>

      <RailSection title="Activity" icon={History} count={runs.length || undefined}>
        {runs.length === 0 ? (
          <p className="text-[12px] leading-5 text-muted-foreground">No automation runs yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {runs.map((run) => (
              <li key={run.id} className="flex items-start gap-2 border-b border-rule/50 pb-2 last:border-b-0 last:pb-0">
                <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-medium text-foreground">
                      {run.kind.replace(/_/g, " ")}
                    </span>
                    <span className={`num text-[10px] uppercase ${runStatusTone(run.status)}`}>
                      {runStatusLabel(run.status)}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{run.summary}</p>
                  <p className="num mt-0.5 text-[10px] text-muted-foreground/70">{formatRunTime(run.startedAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </RailSection>
    </div>
  )
}
