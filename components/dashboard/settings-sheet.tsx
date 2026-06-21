"use client"

import { useEffect, useMemo, useState } from "react"
import {
  BellRing,
  CalendarClock,
  History,
  Info,
  Loader2,
  type LucideIcon,
  Moon,
  Pause,
  SlidersHorizontal,
  Sun,
  Sunrise,
  Sunset,
  Type,
} from "lucide-react"

import { RailSheet } from "@/components/dashboard/rail-sheet"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { AutomationRunSummary } from "@/lib/automation-runs"
import { cn } from "@/lib/utils"

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

const DEFAULT_QUIET_START = "22:00"
const DEFAULT_QUIET_END = "07:00"

const SELECT_CLASS =
  "h-9 w-full rounded-sm border border-rule bg-background px-2.5 text-[13.5px] text-foreground focus-visible:border-rule-strong focus-visible:outline-none disabled:opacity-50"
const INPUT_CLASS =
  "h-9 w-full rounded-sm border border-rule bg-background px-2.5 text-[13.5px] text-foreground focus-visible:border-rule-strong focus-visible:outline-none disabled:opacity-50"
const LABEL_CLASS = "text-[13px] font-medium text-muted-foreground"

export interface PreferencesShape {
  timezone: string
  workdayStart: string
  workdayEnd: string
  defaultTaskDurationMinutes: number
  breakDurationMinutes: number
  preferredFocusBlockMinutes: number | null
  preferredCheckInMode: (typeof CHECK_IN_MODES)[number]
  plannerHorizonDays: number
  morningDigestEnabled: boolean
  eveningDigestEnabled: boolean
  morningDigestTime: string
  eveningDigestTime: string
  quietHoursStart: string | null
  quietHoursEnd: string | null
  sleepPattern: string | null
  peakEnergyWindow: string | null
  procrastinationPattern: string | null
}

export type SettingsCategory =
  | "proactivity"
  | "habits"
  | "planning"
  | "display"
  | "automations"
  | "activity"

const CATEGORIES: { id: SettingsCategory; label: string; icon: LucideIcon }[] = [
  { id: "proactivity", label: "Proactivity", icon: BellRing },
  { id: "habits", label: "Habits", icon: Sun },
  { id: "planning", label: "Planning", icon: SlidersHorizontal },
  { id: "display", label: "Display", icon: Type },
  { id: "automations", label: "Automations", icon: Pause },
  { id: "activity", label: "Activity", icon: History },
]

const PANEL_DESCRIPTIONS: Record<SettingsCategory, string> = {
  proactivity: "When and how JARVIS reaches out by text.",
  habits: "Your day's defaults. JARVIS plans around these but can work outside them when something calls for it.",
  planning: "How JARVIS builds your daily schedule.",
  display: "Appearance on this device.",
  automations: "Background updates and scheduled work.",
  activity: "Recent background runs.",
}

// Tolerate the pre-slider "regular"/"medium" strings still in some devices'
// localStorage; everything else normalizes to a known numeric stop.
function normalizeFontWeight(raw: string | null): number {
  if (raw === "regular") return 400
  if (raw === "medium") return 500
  const value = Number(raw)
  return (FONT_WEIGHT_STOPS as readonly number[]).includes(value) ? value : 500
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
  if (status === "skipped_quiet_hours") return "Quiet"
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

function PanelHeader({ title, info }: { title: string; info?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <h2 className="text-[17px] font-semibold text-foreground">{title}</h2>
      {info ? <InfoHint text={info} /> : null}
    </div>
  )
}

/** A hover "i" that reveals a control's explanation, so the row itself stays clean. */
function InfoHint({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          aria-label="More info"
          onClick={(event) => event.preventDefault()}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground/50 hover:text-foreground"
        >
          <Info className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="end" className="max-w-[230px] text-[12.5px] leading-snug">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

/** A field label row with an optional hover "i" pinned to the right. */
function FieldHead({ label, info }: { label: string; info?: string }) {
  return (
    <span className="flex items-center justify-between gap-1.5">
      <span className={LABEL_CLASS}>{label}</span>
      {info ? <InfoHint text={info} /> : null}
    </span>
  )
}

/** A labeled toggle row: title (+ hover "i") on the left, Switch on the right. */
function ToggleRow({
  title,
  info,
  checked,
  disabled,
  onChange,
}: {
  title: string
  info?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-[14px] font-medium text-foreground">{title}</span>
        {info ? <InfoHint text={info} /> : null}
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} aria-label={title} />
    </div>
  )
}

/** A time input that only commits non-empty values (clearing is a no-op). */
function TimeField({
  label,
  info,
  value,
  disabled,
  onCommit,
}: {
  label: string
  info?: string
  value: string
  disabled?: boolean
  onCommit: (value: string) => void
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <FieldHead label={label} info={info} />
      <input
        type="time"
        className={INPUT_CLASS}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value) onCommit(event.target.value)
        }}
      />
    </label>
  )
}

/** Free-text availability field; commits on blur/Enter, clearing to null when empty. */
function TextPrefField({
  label,
  info,
  placeholder,
  value,
  onCommit,
}: {
  label: string
  info?: string
  placeholder?: string
  value: string | null
  onCommit: (value: string | null) => void
}) {
  const [draft, setDraft] = useState(value ?? "")
  useEffect(() => {
    setDraft(value ?? "")
  }, [value])

  function commit() {
    const trimmed = draft.trim()
    const next = trimmed === "" ? null : trimmed
    if (next !== (value ?? null)) onCommit(next)
  }

  return (
    <label className="flex flex-col gap-1.5">
      <FieldHead label={label} info={info} />
      <input
        className={INPUT_CLASS}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur()
        }}
      />
    </label>
  )
}

export function SettingsSheet({
  open,
  onOpenChange,
  category,
  onCategoryChange,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  category: SettingsCategory
  onCategoryChange: (category: SettingsCategory) => void
  onChanged?: () => void
}) {
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
          morningDigestEnabled: p.morningDigestEnabled ?? true,
          eveningDigestEnabled: p.eveningDigestEnabled ?? true,
          morningDigestTime: p.morningDigestTime ?? "08:30",
          eveningDigestTime: p.eveningDigestTime ?? "18:30",
          quietHoursStart: p.quietHoursStart ?? null,
          quietHoursEnd: p.quietHoursEnd ?? null,
          sleepPattern: p.sleepPattern ?? null,
          peakEnergyWindow: p.peakEnergyWindow ?? null,
          procrastinationPattern: p.procrastinationPattern ?? null,
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

  async function savePatch(patch: Partial<PreferencesShape>) {
    if (!preferences) return
    const previous = preferences
    setSavingField(Object.keys(patch).join(","))
    setError("")
    setPreferences({ ...preferences, ...patch })
    try {
      const response = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      if (!response.ok) {
        throw new Error("save failed")
      }
      onChanged?.()
    } catch {
      // Restore the prior values so the UI never shows an unsaved (or rejected) state.
      setPreferences(previous)
      setError("Could not save that change.")
    } finally {
      setSavingField(null)
    }
  }

  function savePreference(field: keyof PreferencesShape, value: string | number | boolean | null) {
    return savePatch({ [field]: value } as Partial<PreferencesShape>)
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

  const quietHoursOn = Boolean(preferences?.quietHoursStart && preferences?.quietHoursEnd)

  function renderPanel() {
    if (loading || !preferences) {
      return (
        <div className="flex items-center gap-2 py-6 text-[12px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Loading settings…
        </div>
      )
    }

    switch (category) {
      case "proactivity":
        return (
          <div className="flex max-w-[460px] flex-col gap-6">
            <PanelHeader title="Proactivity" info={PANEL_DESCRIPTIONS.proactivity} />

            <section className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Sunrise className="h-3.5 w-3.5 text-copper" aria-hidden="true" strokeWidth={1.75} />
                <span className="eyebrow">Morning planner</span>
              </div>
              <ToggleRow
                title="Send the morning digest"
                info="The day's plan and what's likely to crunch you, sent by text."
                checked={preferences.morningDigestEnabled}
                disabled={savingField === "morningDigestEnabled"}
                onChange={(checked) => void savePreference("morningDigestEnabled", checked)}
              />
              <TimeField
                label="Send at"
                value={preferences.morningDigestTime}
                disabled={!preferences.morningDigestEnabled}
                onCommit={(value) => void savePreference("morningDigestTime", value)}
              />
            </section>

            <section className="flex flex-col gap-3 border-t border-rule pt-5">
              <div className="flex items-center gap-2">
                <Sunset className="h-3.5 w-3.5 text-copper" aria-hidden="true" strokeWidth={1.75} />
                <span className="eyebrow">Evening nudge</span>
              </div>
              <ToggleRow
                title="Send the evening nudge"
                info="A deadline-driven check on what still needs doing. Not sending yet — this saves your preference for when it lands."
                checked={preferences.eveningDigestEnabled}
                disabled={savingField === "eveningDigestEnabled"}
                onChange={(checked) => void savePreference("eveningDigestEnabled", checked)}
              />
              <TimeField
                label="Send at"
                value={preferences.eveningDigestTime}
                disabled={!preferences.eveningDigestEnabled}
                onCommit={(value) => void savePreference("eveningDigestTime", value)}
              />
            </section>

            <section className="flex flex-col gap-3 border-t border-rule pt-5">
              <div className="flex items-center gap-2">
                <Moon className="h-3.5 w-3.5 text-copper" aria-hidden="true" strokeWidth={1.75} />
                <span className="eyebrow">Quiet hours</span>
              </div>
              <ToggleRow
                title="Hold messages overnight"
                info="JARVIS won't text inside this window, even when a digest is due."
                checked={quietHoursOn}
                onChange={(checked) =>
                  void savePatch(
                    checked
                      ? { quietHoursStart: DEFAULT_QUIET_START, quietHoursEnd: DEFAULT_QUIET_END }
                      : { quietHoursStart: null, quietHoursEnd: null },
                  )
                }
              />
              {quietHoursOn ? (
                <div className="grid grid-cols-2 gap-3">
                  <TimeField
                    label="From"
                    value={preferences.quietHoursStart ?? DEFAULT_QUIET_START}
                    onCommit={(value) => void savePreference("quietHoursStart", value)}
                  />
                  <TimeField
                    label="Until"
                    value={preferences.quietHoursEnd ?? DEFAULT_QUIET_END}
                    onCommit={(value) => void savePreference("quietHoursEnd", value)}
                  />
                </div>
              ) : null}
            </section>
          </div>
        )

      case "planning":
        return (
          <div className="flex max-w-[460px] flex-col gap-6">
            <PanelHeader title="Planning" info={PANEL_DESCRIPTIONS.planning} />
            <div className="grid grid-cols-2 gap-3">
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
              <FieldHead
                label="Check-in mode"
                info="How assertively JARVIS checks in on your planned work: silent, quiet, gentle, or active."
              />
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
                <span className="flex items-center gap-1.5">
                  <span className={LABEL_CLASS}>Planner horizon</span>
                  <InfoHint text="How far ahead the planner reads your calendar when scheduling." />
                </span>
                <span className="num text-[12px] text-foreground">
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
            </div>
          </div>
        )

      case "habits":
        return (
          <div className="flex max-w-[460px] flex-col gap-5">
            <PanelHeader title="Habits" info={PANEL_DESCRIPTIONS.habits} />
            <label className="flex flex-col gap-1.5">
              <FieldHead
                label="Timezone"
                info="The timezone your workday hours, quiet hours, and digest times are read in."
              />
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
            <TimeField
              label="Workday start"
              info="When your day begins. JARVIS will try to prioritize scheduling tasks after this time."
              value={preferences.workdayStart}
              onCommit={(value) => void savePreference("workdayStart", value)}
            />
            <TimeField
              label="Workday end"
              info="When your day ends. JARVIS will try to prioritize scheduling tasks before this time."
              value={preferences.workdayEnd}
              onCommit={(value) => void savePreference("workdayEnd", value)}
            />
            <TextPrefField
              label="Sleep pattern"
              placeholder="e.g. 11pm–7am"
              info="When you're usually asleep. JARVIS avoids planning into this window by default, but can when something's urgent."
              value={preferences.sleepPattern}
              onCommit={(value) => void savePreference("sleepPattern", value)}
            />
            <TextPrefField
              label="Peak energy window"
              placeholder="e.g. 9–11am"
              info="When you focus best. JARVIS favors it for your hardest tasks when it can."
              value={preferences.peakEnergyWindow}
              onCommit={(value) => void savePreference("peakEnergyWindow", value)}
            />
          </div>
        )

      case "display":
        return (
          <div className="flex max-w-[460px] flex-col gap-6">
            <PanelHeader title="Display" info={PANEL_DESCRIPTIONS.display} />
            <label className="flex flex-col gap-1.5">
              <span className={LABEL_CLASS}>Font</span>
              <select className={SELECT_CLASS} value={fontFamily} onChange={(event) => chooseFont(event.target.value)}>
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
                <span className="text-[12px] font-medium text-foreground">{FONT_WEIGHT_LABELS[fontWeight] ?? "Medium"}</span>
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
          </div>
        )

      case "automations":
        return (
          <div className="flex max-w-[460px] flex-col gap-6">
            <PanelHeader title="Automations" info={PANEL_DESCRIPTIONS.automations} />
            <ToggleRow
              title="Pause background updates"
              info="Stops the daily refresh cron and the local scheduled tasks. Building a plan by hand still works."
              checked={paused}
              disabled={savingField === "paused"}
              onChange={(checked) => void setPause(checked)}
            />
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
          </div>
        )

      case "activity":
        return (
          <div className="flex max-w-[460px] flex-col gap-5">
            <PanelHeader title="Activity" info={PANEL_DESCRIPTIONS.activity} />
            {runs.length === 0 ? (
              <p className="text-[13px] leading-5 text-muted-foreground">No automation runs yet.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {runs.map((run) => (
                  <li key={run.id} className="flex items-start gap-2 border-b border-rule/50 pb-2.5 last:border-b-0 last:pb-0">
                    <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] font-medium text-foreground">
                          {run.kind.replace(/_/g, " ")}
                        </span>
                        <span className={`num text-[11px] uppercase ${runStatusTone(run.status)}`}>
                          {runStatusLabel(run.status)}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-muted-foreground">{run.summary}</p>
                      <p className="num mt-0.5 text-[11px] text-muted-foreground/70">{formatRunTime(run.startedAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )

      default:
        return null
    }
  }

  return (
    <RailSheet isOpen={open} onClose={() => onOpenChange(false)} title="Settings" width="wide" padded={false}>
      <div className="flex h-full min-h-0">
        <nav className="flex w-[190px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-rule p-2">
          {CATEGORIES.map((item) => {
            const active = item.id === category
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onCategoryChange(item.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center gap-2.5 rounded-sm px-2.5 text-left text-[14px] transition-colors",
                  active
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <Icon
                  className={cn("h-[18px] w-[18px] shrink-0", active ? "text-copper" : "text-muted-foreground/70")}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <span className="truncate">{item.label}</span>
                {item.id === "automations" && paused ? (
                  <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-copper" aria-hidden="true" />
                ) : null}
                {item.id === "activity" && runs.length > 0 ? (
                  <span className="num ml-auto shrink-0 text-[11px] text-muted-foreground">{runs.length}</span>
                ) : null}
              </button>
            )
          })}
        </nav>

        <div className="rail-scroll min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {error ? <p className="mb-4 text-[12px] text-destructive">{error}</p> : null}
          {renderPanel()}
        </div>
      </div>
    </RailSheet>
  )
}
