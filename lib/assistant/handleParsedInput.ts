// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import type { SupabaseClient } from "@supabase/supabase-js"

import type { ParsedAssistantInput } from "@/lib/ai/parser-schema"
import { TASKS_CALENDAR_ID } from "@/lib/tasks-calendar"
import type { TaskStatus, UserPreferencesRow } from "@/types"

const IS_DEV = process.env.NODE_ENV !== "production"
const DEFAULT_TIMEZONE = "America/Chicago"
const DEFAULT_TASK_PRIORITY = "medium"
const DEFAULT_EVENT_DURATION_MINUTES = 60
const ALL_DAY_EVENT_START_TIME = "00:00"
const ALL_DAY_EVENT_END_TIME = "00:00"

interface HandleParsedInputParams {
  userId: string
  parsed: ParsedAssistantInput
  supabase: SupabaseClient
}

interface ExistingTaskRecord {
  id: string
  title: string
  status: TaskStatus
}

interface PreferenceUpsertRow {
  user_id: string
  timezone: string
  sleep_pattern: string | null
  peak_energy_window: string | null
  procrastination_pattern: string | null
  workday_start: string
  workday_end: string
  default_task_duration_minutes: number
  break_duration_minutes: number
  preferred_focus_block_minutes: number | null
  preferred_checkin_mode: "silent" | "quiet" | "gentle" | "active"
  calendar_id: string | null
}

function logDev(action: string, details?: unknown) {
  if (!IS_DEV) {
    return
  }

  console.log(`[assistant-handler] ${action}`, details ?? "")
}

function normalizeNullableText(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeTags(tags: string[] | null | undefined) {
  return Array.from(
    new Set(
      (tags || [])
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
    ),
  )
}

function getDateTimeFormatter(cacheKey: string, formatter: Intl.DateTimeFormat) {
  const existing = formatterCache.get(cacheKey)

  if (existing) {
    return existing
  }

  formatterCache.set(cacheKey, formatter)
  return formatter
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function getLocalDateKey(date: Date, timeZone: string) {
  const formatter = getDateTimeFormatter(
    `assistant-date:${timeZone}`,
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
  )
  const parts = formatter.formatToParts(date)
  const year = parts.find((part) => part.type === "year")?.value
  const month = parts.find((part) => part.type === "month")?.value
  const day = parts.find((part) => part.type === "day")?.value

  if (!year || !month || !day) {
    throw new Error(`Failed to derive a local date key for timezone ${timeZone}.`)
  }

  return `${year}-${month}-${day}`
}

function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  const nextYear = next.getUTCFullYear()
  const nextMonth = String(next.getUTCMonth() + 1).padStart(2, "0")
  const nextDay = String(next.getUTCDate()).padStart(2, "0")

  return `${nextYear}-${nextMonth}-${nextDay}`
}

function getOffsetMinutes(date: Date, timeZone: string) {
  const formatter = getDateTimeFormatter(
    `assistant-offset:${timeZone}`,
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }),
  )
  const offsetLabel = formatter.formatToParts(date).find((part) => part.type === "timeZoneName")?.value || "GMT"

  if (offsetLabel === "GMT") {
    return 0
  }

  const match = offsetLabel.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/)

  if (!match) {
    throw new Error(`Unsupported timezone offset label "${offsetLabel}" for ${timeZone}.`)
  }

  const sign = match[1] === "-" ? -1 : 1
  const hours = Number(match[2])
  const minutes = Number(match[3] ?? "0")

  return sign * (hours * 60 + minutes)
}

function zonedDateTimeToUtc(dateKey: string, time: string, timeZone: string) {
  const [year, month, day] = dateKey.split("-").map(Number)
  const [hours, minutes] = time.split(":").map(Number)
  const localUtcGuess = Date.UTC(year, month - 1, day, hours, minutes, 0, 0)
  let currentMs = localUtcGuess

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offsetMinutes = getOffsetMinutes(new Date(currentMs), timeZone)
    const nextMs = localUtcGuess - offsetMinutes * 60_000

    if (nextMs === currentMs) {
      break
    }

    currentMs = nextMs
  }

  return new Date(currentMs)
}

function resolveTimeLabel(text: string, defaultTime: string | null = null) {
  const normalized = text.toLowerCase()
  const explicitTimeMatch = normalized.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/)

  if (explicitTimeMatch) {
    let hours = Number(explicitTimeMatch[1])
    const minutes = Number(explicitTimeMatch[2] ?? "0")
    const meridiem = explicitTimeMatch[3]

    if (meridiem === "pm" && hours < 12) {
      hours += 12
    }

    if (meridiem === "am" && hours === 12) {
      hours = 0
    }

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
  }

  if (/\bnoon\b/.test(normalized)) return "12:00"
  if (/\bmidnight\b/.test(normalized)) return "00:00"
  if (/\bmorning\b/.test(normalized)) return "09:00"
  if (/\bafternoon\b/.test(normalized)) return "14:00"
  if (/\bevening\b/.test(normalized)) return "18:00"
  if (/\btonight\b|\bnight\b/.test(normalized)) return "20:00"

  return defaultTime
}

function resolveMonthDayDateKey(text: string, now: Date, timeZone: string) {
  const monthNames = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ]
  const match = text
    .toLowerCase()
    .match(
      /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/,
    )

  if (!match) {
    return null
  }

  const monthAliases: Record<string, number> = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
  }

  const monthIndex = monthAliases[match[1]]
  const day = Number(match[2])
  const todayLocal = getLocalDateKey(now, timeZone)
  const [currentYear, currentMonth, currentDay] = todayLocal.split("-").map(Number)

  let year = currentYear
  const currentMonthIndex = currentMonth - 1

  if (monthIndex < currentMonthIndex || (monthIndex === currentMonthIndex && day < currentDay)) {
    year += 1
  }

  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function resolveWeekdayDateKey(text: string, now: Date, timeZone: string) {
  const match = text
    .toLowerCase()
    .match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/)

  if (!match) {
    return null
  }

  const weekdayIndex: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  }

  const today = new Date(now)
  const todayIndex = Number(
    getDateTimeFormatter(
      `assistant-weekday:${timeZone}`,
      new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }),
    )
      .format(today)
      .replace(/[^A-Za-z]/g, "")
      .toLowerCase()
      .replace("thu", "thursday")
      .replace("tue", "tuesday")
      .replace("wed", "wednesday")
      .replace("mon", "monday")
      .replace("fri", "friday")
      .replace("sat", "saturday")
      .replace("sun", "sunday")
  )

  void todayIndex

  const localDateKey = getLocalDateKey(now, timeZone)
  const currentDayIndex = new Date(`${localDateKey}T12:00:00Z`).getUTCDay()
  const targetDayIndex = weekdayIndex[match[1]]
  let delta = targetDayIndex - currentDayIndex

  if (delta < 0) {
    delta += 7
  }

  return addDaysToDateKey(localDateKey, delta)
}

function resolveDateKeyFromText(text: string, now: Date, timeZone: string) {
  const normalized = text.toLowerCase()

  if (/\btomorrow\b/.test(normalized)) {
    return addDaysToDateKey(getLocalDateKey(now, timeZone), 1)
  }

  if (/\btoday\b|\btonight\b/.test(normalized)) {
    return getLocalDateKey(now, timeZone)
  }

  return (
    resolveMonthDayDateKey(text, now, timeZone) ||
    resolveWeekdayDateKey(text, now, timeZone)
  )
}

function resolveNaturalDateTime(
  text: string | null,
  timeZone: string,
  options: { defaultTime?: string | null } = {},
) {
  const normalizedText = normalizeNullableText(text)

  if (!normalizedText) {
    return null
  }

  const isPreciseTimestampInput =
    /^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/i.test(normalizedText) ||
    /\b(?:utc|gmt|z)\b/i.test(normalizedText) ||
    /[+-]\d{2}:\d{2}$/.test(normalizedText)

  if (isPreciseTimestampInput) {
    const directDate = new Date(normalizedText)

    if (Number.isFinite(directDate.getTime())) {
      return directDate.toISOString()
    }
  }

  const now = new Date()
  const dateKey = resolveDateKeyFromText(normalizedText, now, timeZone)
  const timeValue = resolveTimeLabel(normalizedText, options.defaultTime ?? null)

  if (!dateKey || !timeValue) {
    return null
  }

  return zonedDateTimeToUtc(dateKey, timeValue, timeZone).toISOString()
}

function resolveAllDayRange(text: string | null, timeZone: string) {
  const normalizedText = normalizeNullableText(text)

  if (!normalizedText) {
    return null
  }

  const now = new Date()
  const dateKey = resolveDateKeyFromText(normalizedText, now, timeZone)

  if (!dateKey) {
    return null
  }

  return {
    start: zonedDateTimeToUtc(dateKey, ALL_DAY_EVENT_START_TIME, timeZone).toISOString(),
    end: zonedDateTimeToUtc(
      addDaysToDateKey(dateKey, 1),
      ALL_DAY_EVENT_END_TIME,
      timeZone,
    ).toISOString(),
  }
}

function addMinutes(timestamp: string, minutes: number) {
  return new Date(new Date(timestamp).getTime() + minutes * 60_000).toISOString()
}

function getFallbackTaskTitle(parsed: ParsedAssistantInput) {
  return normalizeNullableText(parsed.task.title) || parsed.user_facing_summary || "Untitled task"
}

function getFallbackEventTitle(parsed: ParsedAssistantInput) {
  return normalizeNullableText(parsed.event.title) || parsed.user_facing_summary || "Untitled event"
}

async function loadUserPreferencesRow(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("preferences")
    .select(
      "id, user_id, timezone, sleep_pattern, peak_energy_window, procrastination_pattern, workday_start, workday_end, default_task_duration_minutes, break_duration_minutes, preferred_focus_block_minutes, preferred_checkin_mode, calendar_id, created_at, updated_at",
    )
    .eq("user_id", userId)
    .maybeSingle<UserPreferencesRow>()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

function buildPreferenceUpsertRow(
  userId: string,
  existing: UserPreferencesRow | null,
  updates: Partial<PreferenceUpsertRow>,
): PreferenceUpsertRow {
  return {
    user_id: userId,
    timezone: existing?.timezone || DEFAULT_TIMEZONE,
    sleep_pattern: existing?.sleep_pattern || null,
    peak_energy_window: existing?.peak_energy_window || null,
    procrastination_pattern: existing?.procrastination_pattern || null,
    workday_start: existing?.workday_start || "09:00",
    workday_end: existing?.workday_end || "17:00",
    default_task_duration_minutes: existing?.default_task_duration_minutes || 50,
    break_duration_minutes: existing?.break_duration_minutes ?? 10,
    preferred_focus_block_minutes: existing?.preferred_focus_block_minutes ?? null,
    preferred_checkin_mode: existing?.preferred_checkin_mode || "quiet",
    calendar_id: existing?.calendar_id || null,
    ...updates,
  }
}

function detectPreferenceUpdate(content: string | null) {
  const normalized = normalizeNullableText(content)?.toLowerCase()

  if (!normalized) {
    return null
  }

  const energyMatch = normalized.match(/\b(morning|afternoon|evening|night)\b/)

  if (/(focus better|focus best|best work|most productive|productive)/.test(normalized) && energyMatch) {
    return {
      field: "peak_energy_window" as const,
      value: energyMatch[1],
    }
  }

  const checkInMatch = normalized.match(/\b(silent|quiet|gentle|active)\b/)

  if (/check-?ins?/.test(normalized) && checkInMatch) {
    return {
      field: "preferred_checkin_mode" as const,
      value: checkInMatch[1] as PreferenceUpsertRow["preferred_checkin_mode"],
    }
  }

  return null
}

async function createTask(params: {
  parsed: ParsedAssistantInput
  supabase: SupabaseClient
  userId: string
  timeZone: string
  actionsTaken: string[]
}) {
  const { parsed, supabase, userId, timeZone, actionsTaken } = params
  const deadline = resolveNaturalDateTime(parsed.task.due_at, timeZone, { defaultTime: "23:59" })

  const { error } = await supabase.from("tasks").insert({
    user_id: userId,
    title: getFallbackTaskTitle(parsed),
    description: null,
    deadline,
    duration_minutes: parsed.task.duration_minutes,
    priority: parsed.task.priority ?? DEFAULT_TASK_PRIORITY,
    status: "todo",
    scheduled_for: null,
    is_immutable: false,
    // Tasks without an explicit time are stored as end-of-day deadlines, not all-day blocks.
    all_day: false,
    calendar_id: TASKS_CALENDAR_ID,
    tags: normalizeTags(parsed.task.tags),
  })

  if (error) {
    throw new Error(error.message)
  }

  actionsTaken.push("task_created")
  logDev("task_created", { title: getFallbackTaskTitle(parsed), deadline })
}

async function createScheduleEvent(params: {
  parsed: ParsedAssistantInput
  supabase: SupabaseClient
  userId: string
  timeZone: string
  actionsTaken: string[]
}) {
  const { parsed, supabase, userId, timeZone, actionsTaken } = params
  const allDayRange = parsed.event.all_day ? resolveAllDayRange(parsed.event.start_at, timeZone) : null
  const startAt = allDayRange?.start ?? resolveNaturalDateTime(parsed.event.start_at, timeZone)

  if (!startAt) {
    actionsTaken.push("event_not_created_missing_time")
    logDev("event_not_created_missing_time", { title: parsed.event.title, startAt: parsed.event.start_at })
    return
  }

  const endAt =
    allDayRange?.end ||
    resolveNaturalDateTime(parsed.event.end_at, timeZone) ||
    addMinutes(startAt, DEFAULT_EVENT_DURATION_MINUTES)

  const isImmutable = parsed.event.is_immutable
  const source = isImmutable ? "calendar" : "focus"

  const { error } = await supabase.from("schedule_events").insert({
    user_id: userId,
    task_id: null,
    title: getFallbackEventTitle(parsed),
    starts_at: startAt,
    ends_at: endAt,
    source,
    status: null,
    location: null,
    external_event_id: null,
    is_immutable: isImmutable,
    all_day: parsed.event.all_day,
    calendar_id: parsed.event.calendar_id ?? null,
  })

  if (error) {
    throw new Error(error.message)
  }

  actionsTaken.push(isImmutable ? "fixed_event_created" : "soft_event_created")
  logDev("event_created", {
    title: getFallbackEventTitle(parsed),
    startAt,
    endAt,
    source,
    allDay: parsed.event.all_day,
    isImmutable,
  })
}

async function rememberPreference(params: {
  parsed: ParsedAssistantInput
  supabase: SupabaseClient
  userId: string
  preferencesRow: UserPreferencesRow | null
  actionsTaken: string[]
}) {
  const { parsed, supabase, userId, preferencesRow, actionsTaken } = params
  const content = normalizeNullableText(parsed.memory.content) || parsed.user_facing_summary
  const preferenceUpdate = detectPreferenceUpdate(content)

  if (preferenceUpdate) {
    const { error } = await supabase
      .from("preferences")
      .upsert(
        buildPreferenceUpsertRow(userId, preferencesRow, {
          [preferenceUpdate.field]: preferenceUpdate.value,
        }),
        { onConflict: "user_id" },
      )

    if (error) {
      throw new Error(error.message)
    }

    actionsTaken.push("preference_updated")
    logDev("preference_updated", preferenceUpdate)
    return
  }

  const { error } = await supabase.from("memory_logs").insert({
    user_id: userId,
    category: "behavior",
    insight: content,
    confidence: 0.8,
    source: "assistant_input",
  })

  if (error) {
    throw new Error(error.message)
  }

  actionsTaken.push("memory_logged")
  logDev("memory_logged", { content })
}

async function forgetMemory(params: {
  parsed: ParsedAssistantInput
  supabase: SupabaseClient
  userId: string
  preferencesRow: UserPreferencesRow | null
  actionsTaken: string[]
}) {
  const { parsed, supabase, userId, preferencesRow, actionsTaken } = params
  const content = normalizeNullableText(parsed.memory.content)

  if (!content) {
    actionsTaken.push("forget_memory_clarification_needed")
    return
  }

  const preferenceUpdate = detectPreferenceUpdate(content)

  if (preferenceUpdate && preferencesRow) {
    const { error } = await supabase
      .from("preferences")
      .upsert(
        buildPreferenceUpsertRow(userId, preferencesRow, {
          [preferenceUpdate.field]: null,
        }),
        { onConflict: "user_id" },
      )

    if (error) {
      throw new Error(error.message)
    }

    actionsTaken.push("preference_cleared")
    logDev("preference_cleared", preferenceUpdate)
  }

  const { data, error } = await supabase
    .from("memory_logs")
    .delete()
    .eq("user_id", userId)
    .ilike("insight", `%${content}%`)
    .select("id")

  if (error) {
    throw new Error(error.message)
  }

  if ((data || []).length > 0) {
    actionsTaken.push("memory_deleted")
    logDev("memory_deleted", { content, count: data?.length || 0 })
    return
  }

  if (!actionsTaken.includes("preference_cleared")) {
    actionsTaken.push("forget_memory_no_match")
  }
}

async function findTaskByText(supabase: SupabaseClient, userId: string, targetText: string) {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, status")
    .eq("user_id", userId)
    .ilike("title", `%${targetText}%`)
    .order("updated_at", { ascending: false })
    .limit(5)

  if (error) {
    throw new Error(error.message)
  }

  const tasks = (data || []) as ExistingTaskRecord[]

  if (tasks.length === 0) {
    return null
  }

  const normalizedTarget = targetText.toLowerCase()

  return (
    tasks.find((task) => task.title.toLowerCase() === normalizedTarget) ||
    tasks.find((task) => task.title.toLowerCase().includes(normalizedTarget)) ||
    tasks[0]
  )
}

async function editTask(params: {
  parsed: ParsedAssistantInput
  supabase: SupabaseClient
  userId: string
  actionsTaken: string[]
}) {
  const { parsed, supabase, userId, actionsTaken } = params
  const targetText =
    normalizeNullableText(parsed.task_edit.target_task_text) || normalizeNullableText(parsed.task.title)

  if (!targetText) {
    actionsTaken.push("task_edit_no_target")
    return
  }

  const targetTask = await findTaskByText(supabase, userId, targetText)

  if (!targetTask) {
    actionsTaken.push("task_not_found")
    return
  }

  if (parsed.task_edit.operation === "rename" && parsed.task_edit.new_value) {
    const { error } = await supabase
      .from("tasks")
      .update({ title: parsed.task_edit.new_value.trim() })
      .eq("id", targetTask.id)

    if (error) {
      throw new Error(error.message)
    }

    actionsTaken.push("task_renamed")
    return
  }

  if (parsed.task_edit.operation === "complete") {
    const { error } = await supabase
      .from("tasks")
      .update({ status: "completed" })
      .eq("id", targetTask.id)

    if (error) {
      throw new Error(error.message)
    }

    actionsTaken.push("task_completed")
    return
  }

  if (parsed.task_edit.operation === "delete") {
    const { error } = await supabase
      .from("tasks")
      .delete()
      .eq("id", targetTask.id)

    if (error) {
      throw new Error(error.message)
    }

    actionsTaken.push("task_deleted")
    return
  }

  actionsTaken.push("task_edit_operation_not_supported")
}

// Bridge layer only. This converts validated parsed intent into DB actions without doing scheduling.
export async function handleParsedInput(
  params: HandleParsedInputParams,
): Promise<{
  success: boolean
  actionsTaken: string[]
}> {
  const { userId, parsed, supabase } = params
  const actionsTaken: string[] = []

  try {
    logDev("intent_detected", { intent: parsed.primary_intent, needsClarification: parsed.needs_clarification })

    const preferencesRow = await loadUserPreferencesRow(supabase, userId)
    const timeZone = preferencesRow?.timezone || DEFAULT_TIMEZONE

    switch (parsed.primary_intent) {
      case "create_task":
        await createTask({ parsed, supabase, userId, timeZone, actionsTaken })
        break
      case "create_fixed_event":
        await createScheduleEvent({ parsed, supabase, userId, timeZone, actionsTaken })
        break
      case "remember_preference":
        await rememberPreference({ parsed, supabase, userId, preferencesRow, actionsTaken })
        break
      case "forget_memory":
        await forgetMemory({ parsed, supabase, userId, preferencesRow, actionsTaken })
        break
      case "edit_task":
        await editTask({ parsed, supabase, userId, actionsTaken })
        break
      case "replan":
        actionsTaken.push("replan_requested")
        break
      case "unknown":
      default:
        actionsTaken.push("no_action")
        break
    }

    return {
      success: true,
      actionsTaken,
    }
  } catch (error) {
    logDev("action_failed", error instanceof Error ? error.message : error)

    return {
      success: false,
      actionsTaken,
    }
  }
}

// ##### END BACKEND #####
