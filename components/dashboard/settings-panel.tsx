"use client"

import { useEffect, useMemo, useState } from "react"
import { CalendarClock, Clock, History, Loader2, Pause, SlidersHorizontal, Type } from "lucide-react"

import { RailSection } from "@/components/dashboard/rail-section"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import type { AutomationRunSummary } from "@/lib/automation-runs"

const CHECK_IN_MODES = ["silent", "quiet", "gentle", "active"] as const

// Device-level display prefs. Stored in localStorage and applied via data-* on
// <html> (see app/layout.tsx + globals.css), not the server preferences row.
const FONT_STORAGE_KEY = "jarvis-font"
const FONT_WEIGHT_STORAGE_KEY = "jarvis-font-weight"
const FONT_OPTIONS = [
  { value: "onest", label: "Onest" },
  { value: "geist", label: "Geist" },
  { value: "ibm-plex", label: "IBM Plex Sans" },
  { value: "hanken", label: "Hanken Grotesk" },
  { value: "public-sans", label: "Public Sans" },
] as const
const FONT_WEIGHT_STOPS = [400, 500, 600, 700] as const
const FONT_WEIGHT_LABELS: Record<number, string> = {
  400: "Regular",
  500: "Medium",
  600: "Semibold",
  700: "Bold",
}
// Tolerate the pre-slider "regular"/"medium" strings still in some devices'
// localStorage; everything else normalizes to a known numeric stop.
function normalizeFontWeight(raw: string | null): number {
  if (raw === "regular") return 400
  if (raw === "medium") return 500
  const value = Number(raw)
  return (FONT_WEIGHT_STOPS as readonly number[]).includes(value) ? value : 500
}

interface PreferencesShape {
  timezone: string
  workdayStart: string
  workdayEnd: string
  defaultTaskDurationMinutes: number
  breakDurationMinutes: number
  preferredFocusBlockMinutes: number | null
  preferredCheckInMode: (typeof CHECK_IN_MODES)[number]
  plannerHorizonDays: number
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
  const [fontFamily, setFontFamily] = useState("onest")
  const [fontWeight, setFontWeight] = useState(500)

  useEffect(() => {
    setFontFamily(window.localStorage.getItem(FONT_STORAGE_KEY) || "onest")
    setFontWeight(normalizeFontWeight(window.localStorage.getItem(FONT_WEIGHT_STORAGE_KEY)))
  }, [])

  function chooseFont(value: string) {
    setFontFamily(value)
    window.localStorage.setItem(FONT_STORAGE_KEY, value)
    document.documentElement.setAttribute("data-font", value)
  }

  function chooseFontWeight(value: number) {
    setFontWeight(value)
    window.localStorage.setItem(FONT_WEIGHT_STORAGE_KEY, String(value))
    document.documentElement.setAttribute("data-font-weight", String(value))
  }

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
          plannerHorizonDays: typeof p.plannerHorizonDays === "number" ? p.plannerHorizonDays : 28,
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

      <RailSection title="Display" icon={Type}>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL_CLASS}>Font</span>
          <select
            className={SELECT_CLASS}
            value={fontFamily}
            onChange={(event) => chooseFont(event.target.value)}
          >
            {FONT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className={LABEL_CLASS}>Text weight</span>
            <span className="text-[11px] font-medium text-foreground">
              {FONT_WEIGHT_LABELS[fontWeight] ?? "Medium"}
            </span>
          </div>
          <Slider
            min={400}
            max={700}
            step={100}
            value={[fontWeight]}
            onValueChange={([value]) => chooseFontWeight(value ?? fontWeight)}
            aria-label="Text weight"
            className="py-1"
          />
        </div>
        <p className="text-[10px] leading-snug text-muted-foreground">
          Applies to this device.
        </p>
      </RailSection>

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
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className={LABEL_CLASS}>Planner horizon</span>
            <span className="num text-[11px] text-foreground">
              {Math.round(preferences.plannerHorizonDays / 7)}w
            </span>
          </div>
          <Slider
            min={7}
            max={56}
            step={7}
            value={[preferences.plannerHorizonDays]}
            onValueChange={([value]) =>
              setPreferences({ ...preferences, plannerHorizonDays: value ?? preferences.plannerHorizonDays })
            }
            onValueCommit={([value]) => {
              if (typeof value === "number") void savePreference("plannerHorizonDays", value)
            }}
            aria-label="Planner horizon in weeks"
            className="py-1"
          />
          <p className="text-[10px] leading-snug text-muted-foreground">
            How far ahead the planner reads your calendar when scheduling.
          </p>
        </div>
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
