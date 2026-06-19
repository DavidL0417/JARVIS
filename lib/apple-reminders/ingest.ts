import { createHash } from "node:crypto"

import { loadUserTimezone } from "@/lib/data/user-timezone"
import { insertSourceSnapshot } from "@/lib/sources/persistence"
import { TASKS_CALENDAR_ID } from "@/lib/task-calendar-constants"
import { zonedDateTimeToUtc } from "@/lib/time/zoned"
import type { requireAuthenticatedUser } from "@/lib/supabase/auth"
import type { Priority, TaskInsertRow, TaskStatus } from "@/types"

type AdminClient = Awaited<ReturnType<typeof requireAuthenticatedUser>>["adminClient"]

const REMINDER_TAG = "apple-reminders"
const EXTERNAL_ID_PREFIX = "apple-reminders"

// Destructive-reconcile guard (see ingestAppleReminders): never delete the whole
// mirror off a glitchy snapshot. Only guard a drastic drop once the mirror is large
// enough that a >50% loss is implausible from normal completion.
const REMINDER_UNDERCOUNT_MIN = 8
const REMINDER_UNDERCOUNT_RATIO = 0.5

// One incomplete reminder as sent by the Apple Shortcut ("Find Reminders" output).
export interface IncomingReminder {
  title: string
  notes?: string | null
  dueDate?: string | null
  // Shortcuts exposes priority as a word ("None"/"Low"/"Medium"/"High") on some OS
  // versions and as an iCal integer (0/1/5/9) on others — accept both.
  priority?: string | number | null
  list?: string | null
  allDay?: boolean | null
}

export interface AppleRemindersIngestResult {
  received: number
  upserted: number
  removed: number
}

interface ExistingMirroredTask {
  id: string
  external_task_id: string
  status: TaskStatus
  scheduled_for: string | null
  plan_id: string | null
  priority: Priority
  duration_minutes: number | null
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

function pad2(value: number) {
  return String(value).padStart(2, "0")
}

function normalizeDue(value: string | null | undefined, timeZone: string | null): string | null {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }
  // Apple Shortcuts sends a timezone-less wall clock like "June 16, 2026 at
  // 12:00 PM" (the literal " at " also trips up Date parsing). Read it as UTC
  // first — independent of the server's own timezone — to extract the wall-clock
  // components, then re-anchor them to the user's timezone so 5 PM stays 5 PM.
  const cleaned = trimmed.replace(/\s+at\s+/i, " ")
  let wall = new Date(`${cleaned} UTC`)
  if (Number.isNaN(wall.getTime())) {
    wall = new Date(cleaned)
  }
  if (Number.isNaN(wall.getTime())) {
    return null
  }
  if (!timeZone) {
    return wall.toISOString()
  }
  const dateKey = `${wall.getUTCFullYear()}-${pad2(wall.getUTCMonth() + 1)}-${pad2(wall.getUTCDate())}`
  const time = `${pad2(wall.getUTCHours())}:${pad2(wall.getUTCMinutes())}`
  return zonedDateTimeToUtc(dateKey, time, timeZone).toISOString()
}

function safeJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

// A reminders payload can arrive as text in several forms: a JSON array, a single
// JSON object, or — the shape Apple Shortcuts actually emits when a list of
// dictionaries is dropped into a Text body field — newline-separated JSON objects
// (NDJSON), which is not valid JSON on its own.
function parseObjectsFromText(text: string): unknown[] {
  const trimmed = text.trim()
  if (!trimmed) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return parsed
    if (parsed && typeof parsed === "object") return [parsed]
  } catch {
    // Not a single JSON document — fall through to newline-delimited parsing.
  }
  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => safeJsonObject(line))
    .filter((item): item is Record<string, unknown> => Boolean(item))
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  if (typeof value === "string") {
    return asObjectArray(parseObjectsFromText(value))
  }
  if (!Array.isArray(value)) {
    return value && typeof value === "object" ? [value as Record<string, unknown>] : []
  }
  return value
    .map((item) => (typeof item === "string" ? safeJsonObject(item) : item))
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
}

// Apple Shortcuts serializes the JSON body in OS-dependent shapes. Coerce them all
// into { reminders: object[] }: the canonical { reminders: [...] }, a bare array, a
// stringified/NDJSON reminders value, an array of stringified objects, or a fully
// stringified body — so the Shortcut "just works" regardless.
export function coerceRemindersPayload(body: unknown): { reminders: unknown[] } {
  let value: unknown = body
  if (typeof value === "string") {
    const trimmed = value.trim()
    try {
      value = JSON.parse(trimmed)
    } catch {
      // A bare array/NDJSON body with no { reminders } wrapper.
      return { reminders: asObjectArray(trimmed) }
    }
  }
  if (Array.isArray(value)) {
    return { reminders: asObjectArray(value) }
  }
  if (!value || typeof value !== "object") {
    return { reminders: [] }
  }
  return { reminders: asObjectArray((value as Record<string, unknown>).reminders) }
}

export function mapReminderPriority(value: string | number | null | undefined): Priority {
  if (typeof value === "number") {
    // iCal PRIORITY: 1 (highest) .. 9 (lowest); 0/absent = undefined.
    if (!Number.isFinite(value) || value <= 0) return "medium"
    if (value <= 4) return "high"
    if (value >= 6) return "low"
    return "medium"
  }
  const normalized = value?.trim().toLowerCase()
  if (normalized === "high") return "high"
  if (normalized === "low") return "low"
  return "medium"
}

// Stable per-reminder key so re-syncs upsert in place. Apple Shortcuts doesn't
// surface a clean UID, so we key on list+title+due — a rename creates a new task
// and the old one reconciles away, which is fine for a one-way mirror.
export function reminderExternalTaskId(reminder: IncomingReminder): string {
  const parts = [normalizeText(reminder.list) ?? "", normalizeText(reminder.title) ?? "", normalizeText(reminder.dueDate) ?? ""]
  const hash = createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 32)
  return `${EXTERNAL_ID_PREFIX}:${hash}`
}

export function reminderToTaskInsert(
  userId: string,
  reminder: IncomingReminder,
  timeZone: string | null = null,
): TaskInsertRow {
  return {
    user_id: userId,
    title: normalizeText(reminder.title) ?? "Untitled reminder",
    description: normalizeText(reminder.notes),
    deadline: normalizeDue(reminder.dueDate, timeZone),
    duration_minutes: null,
    priority: mapReminderPriority(reminder.priority),
    status: "todo",
    scheduled_for: null,
    // One-way mirror: reminders are read-only in Jarvis; edits happen on the phone.
    is_immutable: true,
    all_day: Boolean(reminder.allDay),
    calendar_id: TASKS_CALENDAR_ID,
    tags: [REMINDER_TAG],
    external_task_id: reminderExternalTaskId(reminder),
    last_synced_from: "apple_reminders",
  }
}

// Mirrors the Shortcut's full snapshot of incomplete reminders into tasks:
// upsert (preserving planner-owned fields) + reconcile removals + snapshot.
export async function ingestAppleReminders(
  adminClient: AdminClient,
  userId: string,
  reminders: IncomingReminder[],
): Promise<AppleRemindersIngestResult> {
  // Resolve naive Shortcut due times against the user's timezone (see normalizeDue).
  const timeZone = await loadUserTimezone(userId)

  // Dedupe by external id (same list+title+due collapses to one task).
  const byExternalId = new Map<string, TaskInsertRow>()
  for (const reminder of reminders) {
    if (!normalizeText(reminder.title)) {
      continue
    }
    const insert = reminderToTaskInsert(userId, reminder, timeZone)
    if (insert.external_task_id) {
      byExternalId.set(insert.external_task_id, insert)
    }
  }
  const incoming = [...byExternalId.values()]
  const liveIds = new Set(byExternalId.keys())

  const { data: existingRows, error: existingError } = await adminClient
    .from("tasks")
    .select("id, external_task_id, status, scheduled_for, plan_id, priority, duration_minutes")
    .eq("user_id", userId)
    .eq("last_synced_from", "apple_reminders")

  if (existingError) {
    throw new Error(existingError.message)
  }

  const existing = (existingRows ?? []).filter(
    (row): row is ExistingMirroredTask => typeof row.external_task_id === "string",
  )
  const existingByExternalId = new Map(existing.map((row) => [row.external_task_id, row]))

  if (incoming.length > 0) {
    const rows = incoming.map((row) => {
      const prior = row.external_task_id ? existingByExternalId.get(row.external_task_id) : null
      if (!prior) {
        return row
      }
      // Preserve planner-owned fields so a re-sync never clobbers scheduling.
      return {
        ...row,
        status: prior.status,
        scheduled_for: prior.scheduled_for,
        plan_id: prior.plan_id,
        priority: prior.priority,
        duration_minutes: prior.duration_minutes,
      }
    })

    const { error: upsertError } = await adminClient
      .from("tasks")
      .upsert(rows, { onConflict: "user_id,external_task_id" })

    if (upsertError) {
      throw new Error(upsertError.message)
    }
  }

  // Full-snapshot reconcile: any mirrored task not in this payload was completed or
  // deleted on the phone. Remove it (and any planner-created schedule blocks, since
  // the task FK is on-delete-set-null and would otherwise leave a grid ghost).
  const staleIds = existing.filter((row) => !liveIds.has(row.external_task_id)).map((row) => row.id)

  // GUARD: the reconcile is destructive — it deletes every mirrored task absent from
  // the payload. A glitchy Shortcut run (EventKit hiccup, a "Find Reminders" filter
  // that resolved to one list, a permissions blip) can POST an empty or partial
  // snapshot; without this guard a single bad run wipes the whole mirror + its
  // planner blocks. Refuse to delete on an empty payload, and skip the delete on a
  // drastic drop, recording a `partial` snapshot instead of destroying the mirror.
  const emptyPayload = liveIds.size === 0
  const drasticDrop =
    existing.length >= REMINDER_UNDERCOUNT_MIN && liveIds.size < existing.length * REMINDER_UNDERCOUNT_RATIO
  if (staleIds.length > 0 && (emptyPayload || drasticDrop)) {
    const reason = emptyPayload
      ? "empty payload"
      : `incoming ${liveIds.size} < ${Math.round(REMINDER_UNDERCOUNT_RATIO * 100)}% of ${existing.length} mirrored`
    await insertSourceSnapshot({
      adminClient,
      userId,
      source: "apple_reminders",
      freshness: "partial",
      summary: `Apple Reminders sync skipped removal of ${staleIds.length} task(s) — ${reason}. Mirror left intact to avoid data loss.`,
      payload: {
        received: reminders.length,
        upserted: incoming.length,
        removed: 0,
        skippedRemoval: staleIds.length,
        reason,
      },
    })
    return { received: reminders.length, upserted: incoming.length, removed: 0 }
  }

  if (staleIds.length > 0) {
    const { error: scheduleError } = await adminClient
      .from("schedule_events")
      .delete()
      .eq("user_id", userId)
      .in("task_id", staleIds)

    if (scheduleError) {
      throw new Error(scheduleError.message)
    }

    const { error: deleteError } = await adminClient.from("tasks").delete().eq("user_id", userId).in("id", staleIds)

    if (deleteError) {
      throw new Error(deleteError.message)
    }
  }

  await insertSourceSnapshot({
    adminClient,
    userId,
    source: "apple_reminders",
    freshness: "fresh",
    summary: `Synced ${incoming.length} reminder(s) from Apple Reminders.${
      staleIds.length > 0 ? ` Removed ${staleIds.length} completed/deleted.` : ""
    }`,
    payload: { received: reminders.length, upserted: incoming.length, removed: staleIds.length },
  })

  return { received: reminders.length, upserted: incoming.length, removed: staleIds.length }
}
