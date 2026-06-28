import type { SupabaseClient } from "@supabase/supabase-js"

import { insertMemoryItem } from "@/lib/assistant/memory-write"
import type { AssistantRuntimeContext } from "@/lib/assistant/context"
import { resolveNaturalDateTime } from "@/lib/assistant/date-utils"
import { normalizeMemoryContent } from "@/lib/ai/memory-normalize"
import { buildDailyPlan } from "@/lib/daily-plan"
import { loadImessageThread } from "@/lib/imessage/thread"
import { searchGmailForUser } from "@/lib/sources/gmail-search"
import { applyTaskUpdate, createTaskForUser, type TaskUpdateFields } from "@/lib/tasks/mutations"
import { DEFAULT_TIMEZONE } from "@/lib/time/zoned"
import type { AssistantToolCallResult, Priority, TaskStatus } from "@/types"
import { getAgentToolTier, isToolAllowedForSurface, type AgentSurface } from "@/lib/assistant/agent/tools"

export interface AgentExecContext {
  supabase: SupabaseClient
  userId: string
  now: string | null
  timezone: string | null
  surface: AgentSurface
  runtime: AssistantRuntimeContext
  // The user's latest message — rides along on the external-write approval payload.
  command: string
}

export interface AgentToolOutcome {
  // JSON-serializable content handed back to the model as the tool_result.
  resultForModel: unknown
  // Receipt surfaced to the user / persisted to assistant_tool_runs.
  receipt: AssistantToolCallResult
  // Persisted with the tool run (the external-write approval reads payload.action).
  payload?: Record<string, unknown>
  // True when this tool changed durable state (drives needsRefresh).
  didWrite: boolean
}

function receipt(
  tool: string,
  status: AssistantToolCallResult["status"],
  summary: string,
  extra?: Partial<Pick<AssistantToolCallResult, "requiresApproval" | "errorMessage">>,
): AssistantToolCallResult {
  return { id: crypto.randomUUID(), tool, status, summary, ...extra }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

// Human-readable labels for the approval receipt, rendered in the user's timezone
// so what they approve matches what gets written.
function formatCalendarDate(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" })
}
function formatCalendarDateTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}
function formatCalendarTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" })
}

function asPriority(value: unknown): Priority | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined
}

// Resolve a date the model passed: undefined = field omitted, null = clear,
// ISO/natural string = a concrete time. Returns { ok:false } when a non-empty
// value can't be parsed (so we never silently clear a field the user meant to set).
type DateResolution = { ok: true; value: string | null | undefined } | { ok: false; raw: string }

function resolveDate(value: unknown, ctx: AgentExecContext): DateResolution {
  if (value === undefined) return { ok: true, value: undefined }
  if (value === null) return { ok: true, value: null }
  const trimmed = typeof value === "string" ? value.trim() : ""
  if (!trimmed) return { ok: true, value: null }
  const ms = Date.parse(trimmed)
  if (Number.isFinite(ms)) return { ok: true, value: new Date(ms).toISOString() }
  const resolved = resolveNaturalDateTime(trimmed, ctx.timezone || DEFAULT_TIMEZONE, { referenceNow: ctx.now })
  if (resolved) return { ok: true, value: resolved }
  return { ok: false, raw: trimmed }
}

interface CompactTask {
  id: string
  title: string
  status: string
  priority: string
  deadline: string | null
  scheduledFor: string | null
  durationMinutes: number | null
  isImmutable: boolean
  source: string
}

function taskSourceLabel(lastSyncedFrom: string | null): string {
  switch (lastSyncedFrom) {
    case "apple_reminders":
      return "Apple Reminders"
    case "caldav":
      return "Apple Calendar"
    case "notion":
      return "Notion"
    case "gmail":
      return "Gmail"
    case "canvas":
      return "Canvas"
    default:
      return "JARVIS"
  }
}

// ── individual tools ─────────────────────────────────────────────────────────

async function execFindTasks(input: Record<string, unknown>, ctx: AgentExecContext): Promise<AgentToolOutcome> {
  const query = asString(input.query)
  const status = asString(input.status)
  const limit = Math.max(1, Math.min(typeof input.limit === "number" ? input.limit : 10, 25))

  let builder = ctx.supabase
    .from("tasks")
    .select("id, title, status, priority, deadline, scheduled_for, duration_minutes, is_immutable, last_synced_from")
    .eq("user_id", ctx.userId)

  if (status && status !== "any") {
    builder = builder.eq("status", status)
  } else if (!status) {
    builder = builder.in("status", ["todo", "scheduled"])
  }
  if (query) {
    builder = builder.ilike("title", `%${query}%`)
  }

  const { data, error } = await builder.order("created_at", { ascending: false }).limit(limit)
  if (error) {
    throw new Error(error.message)
  }

  const tasks: CompactTask[] = (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    status: row.status as string,
    priority: row.priority as string,
    deadline: (row.deadline as string | null) ?? null,
    scheduledFor: (row.scheduled_for as string | null) ?? null,
    durationMinutes: (row.duration_minutes as number | null) ?? null,
    isImmutable: Boolean(row.is_immutable),
    source: taskSourceLabel((row.last_synced_from as string | null) ?? null),
  }))

  return {
    resultForModel: { tasks, count: tasks.length },
    receipt: receipt("find_tasks", "completed", query ? `Looked up tasks matching "${query}" (${tasks.length}).` : `Listed ${tasks.length} task(s).`),
    didWrite: false,
  }
}

function execGetSchedule(input: Record<string, unknown>, ctx: AgentExecContext): AgentToolOutcome {
  const startMs = asString(input.startIso) ? Date.parse(asString(input.startIso) as string) : Date.now()
  const start = Number.isFinite(startMs) ? startMs : Date.now()
  const endParsed = asString(input.endIso) ? Date.parse(asString(input.endIso) as string) : start + 7 * 24 * 60 * 60 * 1000
  const end = Number.isFinite(endParsed) ? endParsed : start + 7 * 24 * 60 * 60 * 1000

  const events = ctx.runtime.events
    .filter((event) => {
      const eStart = Date.parse(event.start)
      const eEnd = Date.parse(event.end)
      return Number.isFinite(eEnd) && eEnd >= start && Number.isFinite(eStart) && eStart <= end
    })
    .slice(0, 40)
    .map((event) => ({
      title: event.title,
      start: event.start,
      end: event.end,
      source: event.source,
      immutable: event.isImmutable,
    }))

  return {
    resultForModel: { events, count: events.length },
    receipt: receipt("get_schedule", "completed", `Checked the schedule (${events.length} block(s)).`),
    didWrite: false,
  }
}

async function execSearchGmail(input: Record<string, unknown>, ctx: AgentExecContext): Promise<AgentToolOutcome> {
  const query = asString(input.query)
  if (!query) {
    return {
      resultForModel: { error: "A Gmail query is required." },
      receipt: receipt("search_gmail", "error", "Gmail search missing a query.", { errorMessage: "No query provided." }),
      didWrite: false,
    }
  }
  const maxResults = typeof input.maxResults === "number" ? input.maxResults : 8

  try {
    const messages = await searchGmailForUser(ctx.userId, query, maxResults)
    return {
      resultForModel: { messages, count: messages.length },
      receipt: receipt("search_gmail", "completed", `Searched Gmail for "${query}" (${messages.length} result(s)).`),
      didWrite: false,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gmail search failed."
    return {
      resultForModel: { error: message },
      receipt: receipt("search_gmail", "error", "Gmail search failed.", { errorMessage: message }),
      didWrite: false,
    }
  }
}

async function execReadImessage(input: Record<string, unknown>, ctx: AgentExecContext): Promise<AgentToolOutcome> {
  const contact = asString(input.contact)
  if (!contact) {
    return {
      resultForModel: { error: "A contact name is required." },
      receipt: receipt("read_imessage", "error", "iMessage read missing a contact.", { errorMessage: "No contact provided." }),
      didWrite: false,
    }
  }

  const thread = await loadImessageThread(ctx.supabase, ctx.userId, contact)
  if (!thread) {
    return {
      resultForModel: {
        found: false,
        note: `No one matching "${contact}" is on the iMessage allowlist, so there's no archived conversation.`,
      },
      receipt: receipt("read_imessage", "completed", `No allowlisted iMessage contact matched "${contact}".`),
      didWrite: false,
    }
  }

  return {
    resultForModel: { found: true, contactName: thread.contactName, messageCount: thread.messages.length, messages: thread.messages },
    receipt: receipt("read_imessage", "completed", `Read the iMessage thread with ${thread.contactName} (${thread.messages.length} message(s)).`),
    didWrite: false,
  }
}

async function execUpdateTask(input: Record<string, unknown>, ctx: AgentExecContext): Promise<AgentToolOutcome> {
  const taskId = asString(input.taskId)
  if (!taskId) {
    return {
      resultForModel: { ok: false, error: "taskId is required. Use find_tasks first." },
      receipt: receipt("update_task", "error", "Task update missing a taskId.", { errorMessage: "No taskId provided." }),
      didWrite: false,
    }
  }

  const fields: TaskUpdateFields = {}
  const changed: string[] = []

  if (asString(input.title)) {
    fields.title = asString(input.title)
    changed.push("title")
  }
  const priority = asPriority(input.priority)
  if (priority) {
    fields.priority = priority
    changed.push("priority")
  }
  if (typeof input.isImmutable === "boolean") {
    fields.isImmutable = input.isImmutable
    changed.push(input.isImmutable ? "locked" : "unlocked")
  }
  if (typeof input.durationMinutes === "number" || input.durationMinutes === null) {
    fields.durationMinutes = input.durationMinutes as number | null
    changed.push("duration")
  }
  if (typeof input.status === "string" && ["todo", "scheduled", "completed", "missed"].includes(input.status)) {
    fields.status = input.status as TaskStatus
    changed.push(`status→${input.status}`)
  }

  for (const key of ["deadline", "scheduledFor"] as const) {
    if (key in input) {
      const resolved = resolveDate(input[key], ctx)
      if (!resolved.ok) {
        return {
          resultForModel: { ok: false, error: `Couldn't understand the ${key} "${resolved.raw}". Provide an ISO timestamp.` },
          receipt: receipt("update_task", "error", `Unparseable ${key} for task update.`, { errorMessage: resolved.raw }),
          didWrite: false,
        }
      }
      if (resolved.value !== undefined) {
        fields[key] = resolved.value
        changed.push(key)
      }
    }
  }

  if (Object.keys(fields).length === 0) {
    return {
      resultForModel: { ok: false, error: "No fields to update were provided." },
      receipt: receipt("update_task", "error", "Task update had no fields.", { errorMessage: "Empty update." }),
      didWrite: false,
    }
  }

  const result = await applyTaskUpdate({ adminClient: ctx.supabase, userId: ctx.userId, taskId, fields })
  if (!result.ok) {
    return {
      resultForModel: { ok: false, error: "Task not found." },
      receipt: receipt("update_task", "error", "Task not found for update.", { errorMessage: "not_found" }),
      didWrite: false,
    }
  }

  const summary = `Updated "${result.task.title}" (${changed.join(", ")}).`
  return {
    resultForModel: {
      ok: true,
      task: {
        id: result.task.id,
        title: result.task.title,
        status: result.task.status,
        priority: result.task.priority,
        deadline: result.task.deadline,
        scheduledFor: result.task.scheduledFor,
        isImmutable: result.task.isImmutable,
      },
    },
    receipt: receipt("update_task", "completed", summary),
    didWrite: true,
  }
}

async function execCreateTask(input: Record<string, unknown>, ctx: AgentExecContext): Promise<AgentToolOutcome> {
  const title = asString(input.title)
  if (!title) {
    return {
      resultForModel: { ok: false, error: "A title is required." },
      receipt: receipt("create_task", "error", "Task create missing a title.", { errorMessage: "No title." }),
      didWrite: false,
    }
  }

  const deadline = resolveDate(input.deadline, ctx)
  const scheduledFor = resolveDate(input.scheduledFor, ctx)
  if (!deadline.ok || !scheduledFor.ok) {
    const raw = !deadline.ok ? deadline.raw : (scheduledFor as { raw: string }).raw
    return {
      resultForModel: { ok: false, error: `Couldn't understand the date "${raw}".` },
      receipt: receipt("create_task", "error", "Unparseable date for task create.", { errorMessage: raw }),
      didWrite: false,
    }
  }

  const task = await createTaskForUser({
    adminClient: ctx.supabase,
    userId: ctx.userId,
    fields: {
      title,
      priority: asPriority(input.priority),
      deadline: deadline.value ?? null,
      scheduledFor: scheduledFor.value ?? null,
      durationMinutes: typeof input.durationMinutes === "number" ? input.durationMinutes : null,
      isImmutable: typeof input.isImmutable === "boolean" ? input.isImmutable : undefined,
      allDay: typeof input.allDay === "boolean" ? input.allDay : undefined,
    },
  })

  return {
    resultForModel: { ok: true, task: { id: task.id, title: task.title, scheduledFor: task.scheduledFor, deadline: task.deadline, isImmutable: task.isImmutable } },
    receipt: receipt("create_task", "completed", `Created "${task.title}".`),
    didWrite: true,
  }
}

async function execCompleteTask(input: Record<string, unknown>, ctx: AgentExecContext): Promise<AgentToolOutcome> {
  const taskId = asString(input.taskId)
  if (!taskId) {
    return {
      resultForModel: { ok: false, error: "taskId is required. Use find_tasks first." },
      receipt: receipt("complete_task", "error", "Complete missing a taskId.", { errorMessage: "No taskId." }),
      didWrite: false,
    }
  }

  const result = await applyTaskUpdate({ adminClient: ctx.supabase, userId: ctx.userId, taskId, fields: { status: "completed" } })
  if (!result.ok) {
    return {
      resultForModel: { ok: false, error: "Task not found." },
      receipt: receipt("complete_task", "error", "Task not found to complete.", { errorMessage: "not_found" }),
      didWrite: false,
    }
  }

  return {
    resultForModel: { ok: true, task: { id: result.task.id, title: result.task.title }, externalWrite: result.externalWrite },
    receipt: receipt("complete_task", "completed", `Marked "${result.task.title}" done.`),
    didWrite: true,
  }
}

async function execPlanDay(input: Record<string, unknown>, ctx: AgentExecContext): Promise<AgentToolOutcome> {
  const command = asString(input.command) ?? ctx.command
  try {
    const planResult = await buildDailyPlan({
      adminClient: ctx.supabase,
      userId: ctx.userId,
      hardEvents: [],
      command,
    })
    const eventCount = planResult.schedule.proposedEvents.length
    return {
      resultForModel: { ok: true, summary: planResult.dailyPlan.summary, eventCount },
      receipt: receipt("plan_day", "completed", `Rebuilt the plan (${eventCount} block${eventCount === 1 ? "" : "s"}).`),
      didWrite: true,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Planning failed."
    return {
      resultForModel: { ok: false, error: message },
      receipt: receipt("plan_day", "error", "Daily planning failed.", { errorMessage: message }),
      didWrite: false,
    }
  }
}

async function execRemember(input: Record<string, unknown>, ctx: AgentExecContext): Promise<AgentToolOutcome> {
  const content = asString(input.content)
  if (!content) {
    return {
      resultForModel: { ok: false, error: "Nothing to remember was provided." },
      receipt: receipt("remember", "error", "Remember had no content.", { errorMessage: "Empty content." }),
      didWrite: false,
    }
  }

  const normalized = await normalizeMemoryContent(content)
  const { deduped } = await insertMemoryItem(ctx.supabase, {
    user_id: ctx.userId,
    kind: "preference",
    category: "user_instruction",
    content: normalized,
    importance: "medium",
    layer: "durable_preferences",
    source_label: "master_input",
    payload: { promotedFrom: "agent_loop", rawContent: content, normalized: normalized !== content },
    status: "active",
    confidence: 0.9,
  })

  return {
    resultForModel: { ok: true, deduped },
    receipt: receipt("remember", "completed", deduped ? "Already remembered; no duplicate added." : "Saved a durable memory."),
    didWrite: !deduped,
  }
}

function execSyncTasksToGoogle(input: Record<string, unknown>, ctx: AgentExecContext): AgentToolOutcome {
  const reason = asString(input.reason)
  // We do NOT execute here. We register a pending approval (the existing approve
  // route runs syncTaskEventsToGoogleForUser on confirm). payload.action is the
  // contract that route checks.
  return {
    resultForModel: {
      queued: true,
      note: "Queued an approval. Nothing is written to Google Calendar until the user approves it.",
    },
    receipt: receipt(
      "google_task_event_sync",
      "pending_approval",
      "Prepared a Google Calendar sync for your approval.",
      { requiresApproval: true },
    ),
    payload: { action: "google_task_event_sync", command: ctx.command, reason: reason ?? null },
    didWrite: false,
  }
}

// Provider config for the two external calendar-write tools. They share all of the
// validation/time-resolution/approval-queueing logic; only the action contract and
// the user-facing labels differ.
interface CalendarWriteProvider {
  action: "google_calendar_event_create" | "apple_calendar_event_create"
  providerLabel: string
  defaultCalendarLabel: string
}

const GOOGLE_CALENDAR_PROVIDER: CalendarWriteProvider = {
  action: "google_calendar_event_create",
  providerLabel: "Google Calendar",
  defaultCalendarLabel: "your primary Google Calendar",
}

const APPLE_CALENDAR_PROVIDER: CalendarWriteProvider = {
  action: "apple_calendar_event_create",
  providerLabel: "Apple Calendar",
  defaultCalendarLabel: "your default Apple calendar",
}

// Compose an external calendar event for the user. Like the task sync, we do NOT
// write here — we resolve the times to concrete ISO now (so the user approves a
// specific event) and queue a pending approval. The approve route calls the matching
// write fn on confirm; payload.action is the contract.
function queueCalendarEventApproval(
  input: Record<string, unknown>,
  ctx: AgentExecContext,
  provider: CalendarWriteProvider,
): AgentToolOutcome {
  const tool = provider.action
  const title = asString(input.title)
  if (!title) {
    return {
      resultForModel: { ok: false, error: "An event title is required." },
      receipt: receipt(tool, "error", "Calendar event missing a title.", { errorMessage: "No title." }),
      didWrite: false,
    }
  }

  const start = resolveDate(input.startIso, ctx)
  const end = resolveDate(input.endIso, ctx)
  if (!start.ok || !end.ok) {
    const raw = !start.ok ? start.raw : (end as { raw: string }).raw
    return {
      resultForModel: { ok: false, error: `Couldn't understand the time "${raw}". Provide an ISO timestamp.` },
      receipt: receipt(tool, "error", "Unparseable time for calendar event.", { errorMessage: raw }),
      didWrite: false,
    }
  }
  if (!start.value || !end.value) {
    return {
      resultForModel: { ok: false, error: "Both a start and end time are required." },
      receipt: receipt(tool, "error", "Calendar event missing start/end.", { errorMessage: "Missing time." }),
      didWrite: false,
    }
  }

  const allDay = typeof input.allDay === "boolean" ? input.allDay : false

  // Reject inverted / zero-duration windows before they reach the approval queue or
  // the provider (which would 400). All-day allows a same-day (start === end) request.
  const startMs = Date.parse(start.value)
  const endMs = Date.parse(end.value)
  if (allDay ? endMs < startMs : endMs <= startMs) {
    return {
      resultForModel: { ok: false, error: "The end time must be after the start time." },
      receipt: receipt(tool, "error", "Calendar event end is not after start.", { errorMessage: "end_before_start" }),
      didWrite: false,
    }
  }

  const calendarName = asString(input.calendar)
  const description = asString(input.description)
  const location = asString(input.location)
  const calendarLabel = calendarName ? `"${calendarName}"` : provider.defaultCalendarLabel

  // Surface the resolved window in the user's timezone so the approval artifact
  // reflects exactly what will be written (this is the confirm-before-write gate).
  const tz = ctx.timezone || DEFAULT_TIMEZONE
  const whenLabel = allDay
    ? formatCalendarDate(start.value, tz)
    : `${formatCalendarDateTime(start.value, tz)}–${formatCalendarTime(end.value, tz)}`

  return {
    resultForModel: {
      queued: true,
      note: `Queued an approval. The event is written to ${provider.providerLabel} only after the user approves it.`,
      event: { title, startIso: start.value, endIso: end.value, allDay, calendar: calendarName ?? "default" },
    },
    receipt: receipt(
      tool,
      "pending_approval",
      `Prepared "${title}" for ${calendarLabel}, ${whenLabel} — awaiting your approval.`,
      { requiresApproval: true },
    ),
    payload: {
      action: provider.action,
      title,
      startIso: start.value,
      endIso: end.value,
      calendarName: calendarName ?? null,
      description: description ?? null,
      location: location ?? null,
      allDay,
      command: ctx.command,
    },
    didWrite: false,
  }
}

function execCreateCalendarEvent(input: Record<string, unknown>, ctx: AgentExecContext): AgentToolOutcome {
  return queueCalendarEventApproval(input, ctx, GOOGLE_CALENDAR_PROVIDER)
}

function execCreateAppleCalendarEvent(input: Record<string, unknown>, ctx: AgentExecContext): AgentToolOutcome {
  return queueCalendarEventApproval(input, ctx, APPLE_CALENDAR_PROVIDER)
}

const EXECUTORS: Record<string, (input: Record<string, unknown>, ctx: AgentExecContext) => AgentToolOutcome | Promise<AgentToolOutcome>> = {
  find_tasks: execFindTasks,
  get_schedule: execGetSchedule,
  search_gmail: execSearchGmail,
  read_imessage: execReadImessage,
  update_task: execUpdateTask,
  create_task: execCreateTask,
  complete_task: execCompleteTask,
  plan_day: execPlanDay,
  remember: execRemember,
  sync_tasks_to_google: execSyncTasksToGoogle,
  create_calendar_event: execCreateCalendarEvent,
  create_apple_calendar_event: execCreateAppleCalendarEvent,
}

export async function executeAgentTool(
  name: string,
  input: Record<string, unknown>,
  ctx: AgentExecContext,
): Promise<AgentToolOutcome> {
  const tier = getAgentToolTier(name)
  if (!tier) {
    return {
      resultForModel: { error: `Unknown tool "${name}".` },
      receipt: receipt(name, "error", `Unknown tool "${name}".`, { errorMessage: "unknown_tool" }),
      didWrite: false,
    }
  }

  // Defense in depth: the note surface is never offered write/external tools, but
  // never let one execute even if the model hallucinates a call to it.
  if (!isToolAllowedForSurface(name, ctx.surface)) {
    return {
      resultForModel: { error: `The "${name}" action isn't available on this surface. Ask in the app to make that change.` },
      receipt: receipt(name, "error", `"${name}" not permitted on the ${ctx.surface} surface.`, { errorMessage: "surface_forbidden" }),
      didWrite: false,
    }
  }

  const executor = EXECUTORS[name]
  return executor(input, ctx)
}
