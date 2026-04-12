// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"

import { generateSchedule, getClaudeClient } from "@/lib/ai/claude"
import { loadAssistantRuntimeContext, type AssistantRuntimeContext } from "@/lib/assistant/context"
import { getRequiredTasksCalendarPreset } from "@/lib/calendar-config"
import { addMinutes, normalizeNullableText, resolveAllDayRange, resolveNaturalDateTime } from "@/lib/assistant/date-utils"
import { mapTaskToUpdate } from "@/lib/data/mappers"
import { assistantMessageResponseSchema, type AssistantToolCallResultInput } from "@/schemas/assistant"
import type {
  AssistantConversationEntry,
  AssistantMessageResponse,
  AssistantToolCallResult,
  Priority,
  ScheduleEvent,
  Task,
  TaskStatus,
} from "@/types"

const SECRETARY_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6"
const DEFAULT_EVENT_DURATION_MINUTES = 60
const DEFAULT_TOOL_STEPS = 8

type ToolExecutionSuccess = {
  receipt: AssistantToolCallResult
  mutated: boolean
  clarification: string | null
  payload: unknown
}

type ToolExecutionContext = {
  supabase: SupabaseClient
  userId: string
  runtime: AssistantRuntimeContext
  requestMessage: string
  requestNow: string | null
  requestTimezone: string | null
}

type ToolDefinition = {
  name: string
  description: string
  inputSchema: {
    type: "object"
    additionalProperties?: boolean
    properties?: Record<string, unknown>
    required?: string[]
  }
  execute: (input: unknown, context: ToolExecutionContext) => Promise<ToolExecutionSuccess>
}

const listTasksInputSchema = z.object({
  query: z.string().nullable().optional(),
  status: z.enum(["todo", "scheduled", "completed", "missed"]).nullable().optional(),
})

const createTaskInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  dueAt: z.string().nullable().optional(),
  durationMinutes: z.number().int().positive().nullable().optional(),
  priority: z.enum(["low", "medium", "high"]).nullable().optional(),
  allDay: z.boolean().optional().default(false),
  isImmutable: z.boolean().optional().default(false),
  tags: z.array(z.string()).optional().default([]),
  calendarId: z.string().nullable().optional(),
})

const updateTaskInputSchema = z.object({
  target: z.string().min(1),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  dueAt: z.string().nullable().optional(),
  durationMinutes: z.number().int().positive().nullable().optional(),
  priority: z.enum(["low", "medium", "high"]).nullable().optional(),
  status: z.enum(["todo", "scheduled", "completed", "missed"]).nullable().optional(),
  scheduledFor: z.string().nullable().optional(),
  allDay: z.boolean().nullable().optional(),
  isImmutable: z.boolean().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  calendarId: z.string().nullable().optional(),
})

const deleteTaskInputSchema = z.object({
  target: z.string().min(1),
})

const listEventsInputSchema = z.object({
  query: z.string().nullable().optional(),
  from: z.string().nullable().optional(),
  to: z.string().nullable().optional(),
})

const createEventInputSchema = z.object({
  title: z.string().min(1),
  startAt: z.string().min(1),
  endAt: z.string().nullable().optional(),
  allDay: z.boolean().optional().default(false),
  isImmutable: z.boolean().optional().default(true),
  calendarId: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
})

const updateEventInputSchema = z.object({
  target: z.string().min(1),
  title: z.string().nullable().optional(),
  startAt: z.string().nullable().optional(),
  endAt: z.string().nullable().optional(),
  allDay: z.boolean().nullable().optional(),
  isImmutable: z.boolean().nullable().optional(),
  calendarId: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
})

const deleteEventInputSchema = z.object({
  target: z.string().min(1),
})

const rememberMemoryInputSchema = z.object({
  content: z.string().min(1),
  category: z.string().nullable().optional(),
})

const forgetMemoryInputSchema = z.object({
  query: z.string().min(1),
})

const updateAvailabilityInputSchema = z.object({
  timezone: z.string().nullable().optional(),
  workdayStart: z.string().nullable().optional(),
  workdayEnd: z.string().nullable().optional(),
  peakEnergyWindow: z.string().nullable().optional(),
  sleepPattern: z.string().nullable().optional(),
  procrastinationPattern: z.string().nullable().optional(),
  preferredCheckInMode: z.enum(["silent", "quiet", "gentle", "active"]).nullable().optional(),
  defaultTaskDurationMinutes: z.number().int().positive().nullable().optional(),
  breakDurationMinutes: z.number().int().nonnegative().nullable().optional(),
  preferredFocusBlockMinutes: z.number().int().positive().nullable().optional(),
  note: z.string().nullable().optional(),
})

const scheduleTasksInputSchema = z.object({
  taskQuery: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
})

function normalizeTags(tags: string[] | null | undefined) {
  return Array.from(
    new Set(
      (tags || [])
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0),
    ),
  )
}

function makeReceipt(
  tool: string,
  status: AssistantToolCallResult["status"],
  summary: string,
): AssistantToolCallResult {
  return {
    id: crypto.randomUUID(),
    tool,
    status,
    summary,
  }
}

function getTasksCalendarId() {
  return getRequiredTasksCalendarPreset().id
}

function getAssistantManagedCalendarId(existingCalendarId?: string | null) {
  return existingCalendarId || getTasksCalendarId()
}

function getEffectiveTimeZone(context: ToolExecutionContext) {
  return context.requestTimezone || context.runtime.preferences.timezone
}

function getReferenceNow(context: ToolExecutionContext) {
  return context.requestNow
}

function hasRelativeDateCue(text: string) {
  return /\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|this\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i.test(
    text,
  )
}

function hasExplicitCalendarDate(text: string) {
  return (
    /\b\d{4}-\d{2}-\d{2}\b/.test(text) ||
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(text) ||
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/i.test(
      text,
    )
  )
}

function shouldAnchorRelativeDateToRequestMessage(message: string) {
  return hasRelativeDateCue(message) && !hasExplicitCalendarDate(message)
}

function sameUtcDay(leftIso: string, rightIso: string) {
  const left = new Date(leftIso)
  const right = new Date(rightIso)

  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  )
}

function exactOrFuzzyMatch<T extends { id: string; title: string }>(items: T[], query: string) {
  const normalized = query.trim().toLowerCase()

  if (!normalized) {
    return { match: null, clarification: "I need a task or event title to target." }
  }

  const exactById = items.find((item) => item.id === normalized)

  if (exactById) {
    return { match: exactById, clarification: null }
  }

  const exact = items.filter((item) => item.title.trim().toLowerCase() === normalized)

  if (exact.length === 1) {
    return { match: exact[0], clarification: null }
  }

  if (exact.length > 1) {
    return {
      match: null,
      clarification: `Multiple matches found for "${query}". Please be more specific.`,
    }
  }

  const fuzzy = items.filter((item) => item.title.toLowerCase().includes(normalized))

  if (fuzzy.length === 1) {
    return { match: fuzzy[0], clarification: null }
  }

  if (fuzzy.length > 1) {
    return {
      match: null,
      clarification: `Multiple matches found for "${query}". Please be more specific.`,
    }
  }

  return {
    match: null,
    clarification: `I couldn't find anything matching "${query}".`,
  }
}

function serializeTasks(tasks: Task[]) {
  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    deadline: task.deadline,
    scheduledFor: task.scheduledFor,
    allDay: task.allDay,
    tags: task.tags,
  }))
}

function formatEventLocalSnapshot(event: ScheduleEvent, timeZone: string) {
  const start = new Date(event.start)
  const end = new Date(event.end)
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  })

  return {
    localDate: dateFormatter.format(start),
    localStartTime: event.allDay ? "All day" : timeFormatter.format(start),
    localEndTime: event.allDay ? "All day" : timeFormatter.format(end),
    localTimeRange: event.allDay
      ? `All day on ${dateFormatter.format(start)}`
      : `${timeFormatter.format(start)} to ${timeFormatter.format(end)} on ${dateFormatter.format(start)}`,
  }
}

function serializeEvents(events: ScheduleEvent[], timeZone?: string | null) {
  return events.map((event) => ({
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    source: event.source,
    allDay: event.allDay,
    isImmutable: event.isImmutable,
    calendarId: event.calendarId,
    ...(timeZone ? formatEventLocalSnapshot(event, timeZone) : {}),
  }))
}

function resolveEventQueryBoundary(
  value: string | null | undefined,
  timeZone: string,
  referenceNow: string | null,
  defaultTime: string,
) {
  const normalized = normalizeNullableText(value)

  if (!normalized) {
    return null
  }

  const direct = new Date(normalized)

  if (Number.isFinite(direct.getTime())) {
    return direct.toISOString()
  }

  return resolveNaturalDateTime(normalized, timeZone, {
    defaultTime,
    referenceNow,
  })
}

function resolveTaskDeadline(
  value: string | null | undefined,
  allDay: boolean,
  timeZone: string,
  referenceNow?: string | null,
) {
  if (!value) {
    return null
  }

  if (allDay) {
    return resolveAllDayRange(value, timeZone, { referenceNow })?.end ?? null
  }

  return resolveNaturalDateTime(value, timeZone, { defaultTime: "23:59", referenceNow })
}

function resolveEventRange(
  input: {
    startAt: string
    endAt?: string | null
    allDay: boolean
  },
  timeZone: string,
  referenceNow?: string | null,
) {
  if (input.allDay) {
    const range = resolveAllDayRange(input.startAt, timeZone, { referenceNow })

    if (!range) {
      return null
    }

    return range
  }

  const start = resolveNaturalDateTime(input.startAt, timeZone, { referenceNow })

  if (!start) {
    return null
  }

  const end =
    resolveNaturalDateTime(input.endAt ?? null, timeZone, { referenceNow }) ||
    addMinutes(start, DEFAULT_EVENT_DURATION_MINUTES)

  return { start, end }
}

function resolveRequestAnchoredEventRange(
  input: {
    startAt: string
    endAt?: string | null
    allDay: boolean
  },
  context: ToolExecutionContext,
) {
  if (!shouldAnchorRelativeDateToRequestMessage(context.requestMessage)) {
    return null
  }

  const timeZone = getEffectiveTimeZone(context)
  const referenceNow = getReferenceNow(context)
  const expectedRange = resolveEventRange(
    {
      startAt: context.requestMessage,
      endAt: null,
      allDay: input.allDay,
    },
    timeZone,
    referenceNow,
  )

  if (!expectedRange) {
    return null
  }

  const providedRange = resolveEventRange(input, timeZone, referenceNow)

  if (!providedRange) {
    return expectedRange
  }

  if (sameUtcDay(providedRange.start, expectedRange.start)) {
    return providedRange
  }

  if (input.allDay) {
    return expectedRange
  }

  const durationMinutes = Math.max(
    Math.round((new Date(providedRange.end).getTime() - new Date(providedRange.start).getTime()) / 60_000),
    DEFAULT_EVENT_DURATION_MINUTES,
  )

  return {
    start: expectedRange.start,
    end: addMinutes(expectedRange.start, durationMinutes),
  }
}

async function ensurePersistedEvent(
  supabase: SupabaseClient,
  eventId: string,
) {
  const result = await supabase.from("schedule_events").select("id").eq("id", eventId).maybeSingle()

  if (result.error) {
    throw new Error(result.error.message)
  }

  return Boolean(result.data)
}

async function persistSchedulePlan(
  supabase: SupabaseClient,
  userId: string,
  tasks: Task[],
  schedule: Awaited<ReturnType<typeof generateSchedule>>,
) {
  const tasksCalendarId = getTasksCalendarId()
  const selectedTaskIds = tasks.map((task) => task.id)
  const plannedEvents = schedule.proposedEvents.filter(
    (event) => event.source === "task" && event.taskId && selectedTaskIds.includes(event.taskId),
  )

  if (selectedTaskIds.length > 0) {
    const deleteResult = await supabase
      .from("schedule_events")
      .delete()
      .eq("user_id", userId)
      .eq("source", "task")
      .in("task_id", selectedTaskIds)

    if (deleteResult.error) {
      throw new Error(deleteResult.error.message)
    }
  }

  if (plannedEvents.length > 0) {
    const insertResult = await supabase.from("schedule_events").insert(
      plannedEvents.map((event) => ({
        id: event.id,
        user_id: userId,
        task_id: event.taskId,
        title: event.title,
        starts_at: event.start,
        ends_at: event.end,
        source: event.source,
        priority: event.priority ?? "medium",
        status: event.status,
        location: event.location,
        external_event_id: event.externalEventId,
        gcal_event_id: event.gcalEventId,
        last_synced_from: event.lastSyncedFrom ?? "local",
        is_immutable: event.isImmutable,
        is_checked_in: event.isCheckedIn ?? false,
        all_day: event.allDay,
        calendar_id: tasksCalendarId,
      })),
    )

    if (insertResult.error) {
      throw new Error(insertResult.error.message)
    }
  }

  await Promise.all(
    tasks.map(async (task) => {
      const plannedEvent = plannedEvents.find((event) => event.taskId === task.id)
      const updateResult = await supabase
        .from("tasks")
        .update({
          scheduled_for: plannedEvent?.start ?? null,
          status: plannedEvent ? "scheduled" : task.status === "completed" ? "completed" : "todo",
          calendar_id: tasksCalendarId,
        })
        .eq("id", task.id)

      if (updateResult.error) {
        throw new Error(updateResult.error.message)
      }
    }),
  )
}

const toolDefinitions: ToolDefinition[] = [
  {
    name: "list_tasks",
    description: "List current tasks, optionally filtered by title text or status.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        status: { type: "string", enum: ["todo", "scheduled", "completed", "missed"] },
      },
    },
    async execute(input, context) {
      const parsed = listTasksInputSchema.parse(input)
      const tasks = context.runtime.tasks.filter((task) => {
        const matchesQuery = parsed.query
          ? task.title.toLowerCase().includes(parsed.query.toLowerCase())
          : true
        const matchesStatus = parsed.status ? task.status === parsed.status : true
        return matchesQuery && matchesStatus
      })

      return {
        receipt: makeReceipt("list_tasks", "completed", `Found ${tasks.length} matching task${tasks.length === 1 ? "" : "s"}.`),
        mutated: false,
        clarification: null,
        payload: { tasks: serializeTasks(tasks).slice(0, 12) },
      }
    },
  },
  {
    name: "create_task",
    description: "Create a new task with flexible scheduling metadata.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        dueAt: { type: "string" },
        durationMinutes: { type: "number" },
        priority: { type: "string", enum: ["low", "medium", "high"] },
        allDay: { type: "boolean" },
        isImmutable: { type: "boolean" },
        tags: { type: "array", items: { type: "string" } },
        calendarId: { type: "string" },
      },
      required: ["title"],
    },
    async execute(input, context) {
      const parsed = createTaskInputSchema.parse(input)
      const tasksCalendarId = getTasksCalendarId()
      const dueAt = resolveTaskDeadline(
        parsed.dueAt,
        parsed.allDay,
        getEffectiveTimeZone(context),
        getReferenceNow(context),
      )
      const durationMinutes =
        parsed.durationMinutes ?? context.runtime.preferences.defaultTaskDurationMinutes
      const scheduledFor = dueAt ? addMinutes(dueAt, -durationMinutes) : null
      const insertResult = await context.supabase
        .from("tasks")
        .insert({
        user_id: context.userId,
        title: parsed.title.trim(),
        description: normalizeNullableText(parsed.description),
        deadline: dueAt,
        duration_minutes: durationMinutes,
        priority: parsed.priority ?? "medium",
        status: scheduledFor ? "scheduled" : "todo",
        scheduled_for: scheduledFor,
        is_immutable: parsed.isImmutable,
        all_day: parsed.allDay,
        calendar_id: tasksCalendarId,
        tags: normalizeTags(parsed.tags),
      })
      .select("id")
      .single<{ id: string }>()

      if (insertResult.error || !insertResult.data) {
        throw new Error(insertResult.error?.message ?? "Failed to create task.")
      }

      if (scheduledFor) {
        const end = addMinutes(scheduledFor, durationMinutes)
        const eventInsertResult = await context.supabase.from("schedule_events").insert({
          user_id: context.userId,
          task_id: insertResult.data.id,
          title: parsed.title.trim(),
          starts_at: scheduledFor,
          ends_at: end,
          source: "task",
          priority: parsed.priority ?? "medium",
          status: "scheduled",
          location: null,
          external_event_id: null,
          gcal_event_id: null,
          last_synced_from: "local",
          is_immutable: parsed.isImmutable,
          is_checked_in: false,
          all_day: false,
          calendar_id: tasksCalendarId,
        })

        if (eventInsertResult.error) {
          throw new Error(eventInsertResult.error.message)
        }
      }

      return {
        receipt: makeReceipt("create_task", "completed", `Created task "${parsed.title.trim()}".`),
        mutated: true,
        clarification: null,
        payload: { title: parsed.title.trim(), dueAt, scheduledFor },
      }
    },
  },
  {
    name: "update_task",
    description: "Update an existing task by title or id. Use for rename, reprioritize, reschedule, complete, and deadline changes.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        target: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        dueAt: { type: "string" },
        durationMinutes: { type: "number" },
        priority: { type: "string", enum: ["low", "medium", "high"] },
        status: { type: "string", enum: ["todo", "scheduled", "completed", "missed"] },
        scheduledFor: { type: "string" },
        allDay: { type: "boolean" },
        isImmutable: { type: "boolean" },
        tags: { type: "array", items: { type: "string" } },
        calendarId: { type: "string" },
      },
      required: ["target"],
    },
    async execute(input, context) {
      const parsed = updateTaskInputSchema.parse(input)
      const tasksCalendarId = getTasksCalendarId()
      const matched = exactOrFuzzyMatch(context.runtime.tasks, parsed.target)

      if (!matched.match) {
        return {
          receipt: makeReceipt("update_task", "clarification", matched.clarification || "Task target was ambiguous."),
          mutated: false,
          clarification: matched.clarification,
          payload: { clarification: matched.clarification },
        }
      }

      const task = matched.match
      const allDay = parsed.allDay ?? task.allDay
      const deadline = parsed.dueAt !== undefined
        ? resolveTaskDeadline(parsed.dueAt, allDay, getEffectiveTimeZone(context), getReferenceNow(context))
        : task.deadline
      const scheduledFor =
        parsed.scheduledFor !== undefined
          ? resolveNaturalDateTime(parsed.scheduledFor, getEffectiveTimeZone(context), {
              referenceNow: getReferenceNow(context),
            })
          : task.scheduledFor

      const updateResult = await context.supabase
        .from("tasks")
        .update(
          mapTaskToUpdate({
            title: parsed.title ?? task.title,
            description: parsed.description !== undefined ? parsed.description : task.description,
            deadline,
            durationMinutes: parsed.durationMinutes !== undefined ? parsed.durationMinutes : task.durationMinutes,
            priority: (parsed.priority ?? task.priority) as Priority,
            status: (parsed.status ?? (scheduledFor ? "scheduled" : task.status)) as TaskStatus,
            scheduledFor: parsed.status === "completed" ? null : scheduledFor,
            allDay,
            isImmutable: parsed.isImmutable ?? task.isImmutable,
            tags: parsed.tags !== undefined && parsed.tags !== null ? parsed.tags : task.tags,
            calendarId: tasksCalendarId,
          }),
        )
        .eq("id", task.id)

      if (updateResult.error) {
        throw new Error(updateResult.error.message)
      }

      if (scheduledFor !== task.scheduledFor || parsed.status === "scheduled" || parsed.status === "todo" || parsed.status === "completed") {
        const deleteResult = await context.supabase
          .from("schedule_events")
          .delete()
          .eq("user_id", context.userId)
          .eq("source", "task")
          .eq("task_id", task.id)

        if (deleteResult.error) {
          throw new Error(deleteResult.error.message)
        }

        if (scheduledFor && parsed.status !== "completed") {
          const end = addMinutes(scheduledFor, parsed.durationMinutes ?? task.durationMinutes ?? context.runtime.preferences.defaultTaskDurationMinutes)
          const insertResult = await context.supabase.from("schedule_events").insert({
            user_id: context.userId,
            task_id: task.id,
            title: parsed.title ?? task.title,
            starts_at: scheduledFor,
            ends_at: end,
            source: "task",
            priority: task.priority,
            status: "scheduled",
            location: null,
            external_event_id: null,
            gcal_event_id: null,
            last_synced_from: "local",
            is_immutable: parsed.isImmutable ?? task.isImmutable,
            is_checked_in: false,
            all_day: allDay,
            calendar_id: tasksCalendarId,
          })

          if (insertResult.error) {
            throw new Error(insertResult.error.message)
          }
        }
      }

      return {
        receipt: makeReceipt("update_task", "completed", `Updated task "${parsed.title ?? task.title}".`),
        mutated: true,
        clarification: null,
        payload: { taskId: task.id },
      }
    },
  },
  {
    name: "delete_task",
    description: "Delete a task by title or id.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        target: { type: "string" },
      },
      required: ["target"],
    },
    async execute(input, context) {
      const parsed = deleteTaskInputSchema.parse(input)
      const matched = exactOrFuzzyMatch(context.runtime.tasks, parsed.target)

      if (!matched.match) {
        return {
          receipt: makeReceipt("delete_task", "clarification", matched.clarification || "Task target was ambiguous."),
          mutated: false,
          clarification: matched.clarification,
          payload: { clarification: matched.clarification },
        }
      }

      const task = matched.match
      const [deleteTaskResult, deleteEventsResult] = await Promise.all([
        context.supabase.from("tasks").delete().eq("id", task.id),
        context.supabase.from("schedule_events").delete().eq("task_id", task.id),
      ])

      if (deleteTaskResult.error) {
        throw new Error(deleteTaskResult.error.message)
      }

      if (deleteEventsResult.error) {
        throw new Error(deleteEventsResult.error.message)
      }

      return {
        receipt: makeReceipt("delete_task", "completed", `Deleted task "${task.title}".`),
        mutated: true,
        clarification: null,
        payload: { taskId: task.id },
      }
    },
  },
  {
    name: "list_events",
    description: "List events, commitments, and scheduled task blocks.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
      },
    },
    async execute(input, context) {
      const parsed = listEventsInputSchema.parse(input)
      const timeZone = getEffectiveTimeZone(context)
      const referenceNow = getReferenceNow(context)
      const fromIso = resolveEventQueryBoundary(parsed.from, timeZone, referenceNow, "00:00")
      const toIso = resolveEventQueryBoundary(parsed.to, timeZone, referenceNow, "23:59")
      const fromMs = fromIso ? new Date(fromIso).getTime() : Number.NEGATIVE_INFINITY
      const toMs = toIso ? new Date(toIso).getTime() : Number.POSITIVE_INFINITY
      const events = context.runtime.events.filter((event) => {
        const titleMatch = parsed.query
          ? event.title.toLowerCase().includes(parsed.query.toLowerCase())
          : true
        const startMs = new Date(event.start).getTime()
        const endMs = new Date(event.end).getTime()
        const overlapsRange = startMs < toMs && endMs > fromMs
        return titleMatch && overlapsRange
      })

      return {
        receipt: makeReceipt("list_events", "completed", `Found ${events.length} matching event${events.length === 1 ? "" : "s"}.`),
        mutated: false,
        clarification: null,
        payload: {
          timeZone,
          from: fromIso,
          to: toIso,
          events: serializeEvents(events, timeZone).slice(0, 12),
        },
      }
    },
  },
  {
    name: "create_event",
    description: "Create a calendar or focus event.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        startAt: { type: "string" },
        endAt: { type: "string" },
        allDay: { type: "boolean" },
        isImmutable: { type: "boolean" },
        calendarId: { type: "string" },
        location: { type: "string" },
      },
      required: ["title", "startAt"],
    },
    async execute(input, context) {
      const parsed = createEventInputSchema.parse(input)
      const tasksCalendarId = getTasksCalendarId()
      const range =
        resolveRequestAnchoredEventRange(parsed, context) ||
        resolveEventRange(parsed, getEffectiveTimeZone(context), getReferenceNow(context))

      if (!range) {
        return {
          receipt: makeReceipt("create_event", "clarification", "I need a resolvable event date or time to create that."),
          mutated: false,
          clarification: "I need a resolvable event date or time to create that.",
          payload: { clarification: "I need a resolvable event date or time to create that." },
        }
      }

      const insertResult = await context.supabase.from("schedule_events").insert({
        user_id: context.userId,
        task_id: null,
        title: parsed.title.trim(),
        starts_at: range.start,
        ends_at: range.end,
        source: parsed.isImmutable ? "calendar" : "focus",
        priority: "medium",
        status: null,
        location: normalizeNullableText(parsed.location),
        external_event_id: null,
        gcal_event_id: null,
        last_synced_from: "local",
        is_immutable: parsed.isImmutable,
        is_checked_in: false,
        all_day: parsed.allDay,
        calendar_id: tasksCalendarId,
      })

      if (insertResult.error) {
        throw new Error(insertResult.error.message)
      }

      return {
        receipt: makeReceipt("create_event", "completed", `Created event "${parsed.title.trim()}".`),
        mutated: true,
        clarification: null,
        payload: { title: parsed.title.trim(), start: range.start, end: range.end },
      }
    },
  },
  {
    name: "update_event",
    description: "Update, move, rename, or change an event by title or id.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        target: { type: "string" },
        title: { type: "string" },
        startAt: { type: "string" },
        endAt: { type: "string" },
        allDay: { type: "boolean" },
        isImmutable: { type: "boolean" },
        calendarId: { type: "string" },
        location: { type: "string" },
      },
      required: ["target"],
    },
    async execute(input, context) {
      const parsed = updateEventInputSchema.parse(input)
      const tasksCalendarId = getTasksCalendarId()
      const matched = exactOrFuzzyMatch(context.runtime.events, parsed.target)

      if (!matched.match) {
        return {
          receipt: makeReceipt("update_event", "clarification", matched.clarification || "Event target was ambiguous."),
          mutated: false,
          clarification: matched.clarification,
          payload: { clarification: matched.clarification },
        }
      }

      const event = matched.match
      const isPersisted = await ensurePersistedEvent(context.supabase, event.id)

      if (!isPersisted) {
        return {
          receipt: makeReceipt("update_event", "clarification", `The event "${event.title}" is coming from the demo calendar feed and can't be edited in place yet.`),
          mutated: false,
          clarification: `The event "${event.title}" is coming from the demo calendar feed and can't be edited in place yet.`,
          payload: { clarification: `The event "${event.title}" is coming from the demo calendar feed and can't be edited in place yet.` },
        }
      }

      const nextAllDay = parsed.allDay ?? event.allDay
      let range = { start: event.start, end: event.end }

      if (parsed.startAt || parsed.endAt || parsed.allDay !== undefined) {
        const sourceStart = parsed.startAt ?? event.start
        const resolvedRange =
          resolveRequestAnchoredEventRange(
            {
              startAt: sourceStart,
              endAt: parsed.endAt ?? event.end,
              allDay: nextAllDay,
            },
            context,
          ) ||
          resolveEventRange(
            {
              startAt: sourceStart,
              endAt: parsed.endAt ?? event.end,
              allDay: nextAllDay,
            },
            getEffectiveTimeZone(context),
            getReferenceNow(context),
          )

        if (!resolvedRange) {
          return {
            receipt: makeReceipt("update_event", "clarification", "I need a clearer replacement date or time for that event."),
            mutated: false,
            clarification: "I need a clearer replacement date or time for that event.",
            payload: { clarification: "I need a clearer replacement date or time for that event." },
          }
        }

        range = resolvedRange
      }

      const updateResult = await context.supabase
        .from("schedule_events")
        .update({
          title: parsed.title ?? event.title,
          starts_at: range.start,
          ends_at: range.end,
          priority: event.priority,
          is_immutable: parsed.isImmutable ?? event.isImmutable,
          is_checked_in: event.isCheckedIn,
          all_day: nextAllDay,
          calendar_id:
            parsed.calendarId !== undefined
              ? tasksCalendarId
              : getAssistantManagedCalendarId(event.calendarId),
          location: parsed.location !== undefined ? normalizeNullableText(parsed.location) : event.location,
          gcal_event_id: event.gcalEventId,
          last_synced_from: "local",
          source: parsed.isImmutable === false ? "focus" : parsed.isImmutable === true ? "calendar" : event.source,
        })
        .eq("id", event.id)

      if (updateResult.error) {
        throw new Error(updateResult.error.message)
      }

      return {
        receipt: makeReceipt("update_event", "completed", `Updated event "${parsed.title ?? event.title}".`),
        mutated: true,
        clarification: null,
        payload: { eventId: event.id },
      }
    },
  },
  {
    name: "delete_event",
    description: "Delete an event by title or id.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        target: { type: "string" },
      },
      required: ["target"],
    },
    async execute(input, context) {
      const parsed = deleteEventInputSchema.parse(input)
      const matched = exactOrFuzzyMatch(context.runtime.events, parsed.target)

      if (!matched.match) {
        return {
          receipt: makeReceipt("delete_event", "clarification", matched.clarification || "Event target was ambiguous."),
          mutated: false,
          clarification: matched.clarification,
          payload: { clarification: matched.clarification },
        }
      }

      const event = matched.match
      const isPersisted = await ensurePersistedEvent(context.supabase, event.id)

      if (!isPersisted) {
        return {
          receipt: makeReceipt("delete_event", "clarification", `The event "${event.title}" is coming from the demo calendar feed and can't be deleted in place yet.`),
          mutated: false,
          clarification: `The event "${event.title}" is coming from the demo calendar feed and can't be deleted in place yet.`,
          payload: { clarification: `The event "${event.title}" is coming from the demo calendar feed and can't be deleted in place yet.` },
        }
      }

      const deleteResult = await context.supabase.from("schedule_events").delete().eq("id", event.id)

      if (deleteResult.error) {
        throw new Error(deleteResult.error.message)
      }

      return {
        receipt: makeReceipt("delete_event", "completed", `Deleted event "${event.title}".`),
        mutated: true,
        clarification: null,
        payload: { eventId: event.id },
      }
    },
  },
  {
    name: "read_memory",
    description: "Read current saved memory notes for the secretary.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    async execute(_input, context) {
      return {
        receipt: makeReceipt("read_memory", "completed", `Loaded ${context.runtime.memoryEntries.length} memory note${context.runtime.memoryEntries.length === 1 ? "" : "s"}.`),
        mutated: false,
        clarification: null,
        payload: {
          memoryEntries: context.runtime.memoryEntries,
          memorySummary: context.runtime.context.memorySummary,
        },
      }
    },
  },
  {
    name: "remember_memory",
    description: "Store a new memory or preference note for later scheduling decisions.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        content: { type: "string" },
        category: { type: "string" },
      },
      required: ["content"],
    },
    async execute(input, context) {
      const parsed = rememberMemoryInputSchema.parse(input)
      const insertResult = await context.supabase.from("memory_logs").insert({
        user_id: context.userId,
        category: normalizeNullableText(parsed.category) || "behavior",
        insight: parsed.content.trim(),
        confidence: 0.85,
        source: "assistant_secretary",
      })

      if (insertResult.error) {
        throw new Error(insertResult.error.message)
      }

      return {
        receipt: makeReceipt("remember_memory", "completed", "Saved a new memory note."),
        mutated: true,
        clarification: null,
        payload: { content: parsed.content.trim() },
      }
    },
  },
  {
    name: "forget_memory",
    description: "Delete one or more saved memory notes matching the provided text.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
    async execute(input, context) {
      const parsed = forgetMemoryInputSchema.parse(input)
      const deleteResult = await context.supabase
        .from("memory_logs")
        .delete()
        .eq("user_id", context.userId)
        .ilike("insight", `%${parsed.query}%`)
        .select("id")

      if (deleteResult.error) {
        throw new Error(deleteResult.error.message)
      }

      const deletedCount = (deleteResult.data || []).length

      if (deletedCount === 0) {
        return {
          receipt: makeReceipt("forget_memory", "clarification", `I couldn't find a saved memory note matching "${parsed.query}".`),
          mutated: false,
          clarification: `I couldn't find a saved memory note matching "${parsed.query}".`,
          payload: { clarification: `I couldn't find a saved memory note matching "${parsed.query}".` },
        }
      }

      return {
        receipt: makeReceipt("forget_memory", "completed", `Removed ${deletedCount} memory note${deletedCount === 1 ? "" : "s"}.`),
        mutated: true,
        clarification: null,
        payload: { deletedCount },
      }
    },
  },
  {
    name: "read_availability",
    description: "Read the current availability and no-work context used for scheduling.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    async execute(_input, context) {
      return {
        receipt: makeReceipt("read_availability", "completed", "Loaded the current availability context."),
        mutated: false,
        clarification: null,
        payload: context.runtime.context.availability,
      }
    },
  },
  {
    name: "update_availability",
    description: "Update work hours, timezone, check-in mode, or softer no-work notes.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        timezone: { type: "string" },
        workdayStart: { type: "string" },
        workdayEnd: { type: "string" },
        peakEnergyWindow: { type: "string" },
        sleepPattern: { type: "string" },
        procrastinationPattern: { type: "string" },
        preferredCheckInMode: { type: "string", enum: ["silent", "quiet", "gentle", "active"] },
        defaultTaskDurationMinutes: { type: "number" },
        breakDurationMinutes: { type: "number" },
        preferredFocusBlockMinutes: { type: "number" },
        note: { type: "string" },
      },
    },
    async execute(input, context) {
      const parsed = updateAvailabilityInputSchema.parse(input)
      const preferences = context.runtime.preferences
      const upsertResult = await context.supabase
        .from("preferences")
        .upsert(
          {
            user_id: context.userId,
            timezone: parsed.timezone ?? preferences.timezone,
            sleep_pattern: parsed.sleepPattern !== undefined ? normalizeNullableText(parsed.sleepPattern) : preferences.sleepPattern,
            peak_energy_window:
              parsed.peakEnergyWindow !== undefined ? normalizeNullableText(parsed.peakEnergyWindow) : preferences.peakEnergyWindow,
            procrastination_pattern:
              parsed.procrastinationPattern !== undefined
                ? normalizeNullableText(parsed.procrastinationPattern)
                : preferences.procrastinationPattern,
            workday_start: parsed.workdayStart ?? preferences.workdayStart,
            workday_end: parsed.workdayEnd ?? preferences.workdayEnd,
            default_task_duration_minutes:
              parsed.defaultTaskDurationMinutes ?? preferences.defaultTaskDurationMinutes,
            break_duration_minutes: parsed.breakDurationMinutes ?? preferences.breakDurationMinutes,
            preferred_focus_block_minutes:
              parsed.preferredFocusBlockMinutes !== undefined
                ? parsed.preferredFocusBlockMinutes
                : preferences.preferredFocusBlockMinutes,
            preferred_checkin_mode: parsed.preferredCheckInMode ?? preferences.preferredCheckInMode,
            calendar_id: preferences.calendarId,
          },
          { onConflict: "user_id" },
        )

      if (upsertResult.error) {
        throw new Error(upsertResult.error.message)
      }

      if (normalizeNullableText(parsed.note)) {
        const memoryInsertResult = await context.supabase.from("memory_logs").insert({
          user_id: context.userId,
          category: "availability",
          insight: parsed.note?.trim(),
          confidence: 0.9,
          source: "assistant_secretary",
        })

        if (memoryInsertResult.error) {
          throw new Error(memoryInsertResult.error.message)
        }
      }

      return {
        receipt: makeReceipt("update_availability", "completed", "Updated the availability context."),
        mutated: true,
        clarification: null,
        payload: { updated: true },
      }
    },
  },
  {
    name: "schedule_tasks",
    description: "Generate and persist scheduled task events. Availability is soft guidance, not a hard constraint.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        taskQuery: { type: "string" },
        reason: { type: "string" },
      },
    },
    async execute(input, context) {
      const parsed = scheduleTasksInputSchema.parse(input)
      const selectedTasks = parsed.taskQuery
        ? context.runtime.tasks.filter((task) => task.title.toLowerCase().includes(parsed.taskQuery!.toLowerCase()))
        : context.runtime.tasks.filter((task) => task.status !== "completed")

      if (selectedTasks.length === 0) {
        return {
          receipt: makeReceipt("schedule_tasks", "clarification", "I couldn't find any tasks to schedule from that request."),
          mutated: false,
          clarification: "I couldn't find any tasks to schedule from that request.",
          payload: { clarification: "I couldn't find any tasks to schedule from that request." },
        }
      }

      const selectedTaskIds = new Set(selectedTasks.map((task) => task.id))
      const schedule = await generateSchedule({
        userId: context.userId,
        tasks: selectedTasks,
        preferences: context.runtime.preferences,
        hardEvents: context.runtime.events.filter(
          (event) => !(event.source === "task" && event.taskId && selectedTaskIds.has(event.taskId)),
        ),
      })

      await persistSchedulePlan(context.supabase, context.userId, selectedTasks, schedule)

      return {
        receipt: makeReceipt("schedule_tasks", "completed", schedule.summary),
        mutated: true,
        clarification: null,
        payload: {
          summary: schedule.summary,
          scheduledEvents: serializeEvents(schedule.proposedEvents),
          unscheduledTaskIds: schedule.unscheduledTaskIds,
        },
      }
    },
  },
  {
    name: "replan_schedule",
    description: "Re-run scheduling for the selected tasks after a change in plans.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        taskQuery: { type: "string" },
        reason: { type: "string" },
      },
    },
    async execute(input, context) {
      const parsed = scheduleTasksInputSchema.parse(input)
      const scheduleResult = await toolDefinitions.find((tool) => tool.name === "schedule_tasks")!.execute(parsed, context)
      return {
        ...scheduleResult,
        receipt: makeReceipt(
          "replan_schedule",
          scheduleResult.receipt.status,
          parsed.reason ? `${scheduleResult.receipt.summary} Replan reason: ${parsed.reason}.` : scheduleResult.receipt.summary,
        ),
      }
    },
  },
]

function buildToolArray() {
  return toolDefinitions.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }))
}

function formatCurrentMomentForPrompt(now: string | null, timeZone: string) {
  const referenceDate = now ? new Date(now) : new Date()

  if (!Number.isFinite(referenceDate.getTime())) {
    return "Current local time is unavailable."
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(referenceDate)
}

function buildSystemPrompt(
  context: AssistantRuntimeContext,
  requestContext: { now: string | null; timeZone: string },
) {
  return [
    "You are JARVIS, a secretary-style assistant operating a student's schedule and task system.",
    "Act like a smart, conversational executive assistant who is actually talking to the user, not filling out a form.",
    "Use tools whenever you need to inspect or change data.",
    "You may create, update, move, or delete tasks and events, and you may edit memory and availability context.",
    'Create timed appointments or calendar blocks with create_event. Use create_task for actionable work items; tasks only appear on the calendar after they have a scheduled block or date anchor.',
    'All assistant-managed calendar writes belong in the Tasks calendar. If no calendar named "Tasks" or "Task" is configured, explain that clearly instead of pretending the write succeeded.',
    `Current local time for this request: ${formatCurrentMomentForPrompt(requestContext.now, requestContext.timeZone)}.`,
    "For relative dates like today, tomorrow, tonight, or a weekday name, anchor them to that current local time.",
    "When the user gives a relative date, do not invent a month, day, or year that they did not say.",
    "When list_events returns localDate, localStartTime, localEndTime, or localTimeRange, use those local fields for reasoning and replies instead of reading the raw UTC timestamps literally.",
    "Availability is context, not a hard rule. You may schedule outside the preferred/no-work windows when needed.",
    "If you do place work outside the stated availability context, explicitly mention that tradeoff in your final reply.",
    "Never claim a change happened unless a tool succeeded.",
    "If a target is ambiguous or missing, ask for clarification instead of guessing.",
    "After using tools, end with a natural conversational reply to the user in 2-5 sentences.",
    "Do not answer with only a terse action log, tool recap, or calendar-style summary.",
    "Briefly acknowledge what the user asked, say what you changed, and mention any tradeoffs or follow-up needed.",
    "",
    "Current secretary context:",
    context.context.availability.availabilitySummary,
    "",
    "Memory summary:",
    context.context.memorySummary,
  ].join("\n")
}

function buildInitialUserPrompt(
  message: string,
  context: AssistantRuntimeContext,
  requestContext: { now: string | null; timeZone: string },
) {
  return [
    `User request: ${message}`,
    "",
    `Current local time: ${formatCurrentMomentForPrompt(requestContext.now, requestContext.timeZone)}`,
    `Current time zone: ${requestContext.timeZone}`,
    `Current work hours: ${context.preferences.workdayStart} to ${context.preferences.workdayEnd}`,
    `Saved memory notes: ${context.memoryEntries.length}`,
    `Open tasks: ${context.tasks.filter((task) => task.status !== "completed").length}`,
    `Events in system: ${context.events.length}`,
    "",
    "You can inspect more detail with tools. Use the fewest tools needed, but do not skip them for mutations.",
    "Your final answer must feel like a real reply to the user, not an internal system trace.",
  ].join("\n")
}

function buildFallbackReply(toolCalls: AssistantToolCallResult[], clarification: string | null) {
  if (clarification) {
    return clarification
  }

  if (toolCalls.length === 0) {
    return "I wasn't able to take action from that request."
  }

  const completed = toolCalls
    .filter((toolCall) => toolCall.status === "completed")
    .map((toolCall) => toolCall.summary)
  const clarificationNotes = toolCalls
    .filter((toolCall) => toolCall.status === "clarification")
    .map((toolCall) => toolCall.summary)

  if (completed.length > 0 && clarificationNotes.length > 0) {
    return `I made the requested updates: ${completed.join(" ")} I still need clarification on this part: ${clarificationNotes.join(" ")}`
  }

  if (completed.length > 0) {
    return `I took care of it. ${completed.join(" ")}`
  }

  return `I need a bit more detail before I can finish that. ${clarificationNotes.join(" ")}`
}

async function executeToolByName(
  toolName: string,
  input: unknown,
  context: ToolExecutionContext,
) {
  const definition = toolDefinitions.find((tool) => tool.name === toolName)

  if (!definition) {
    return {
      receipt: makeReceipt(toolName, "error", `Unknown tool "${toolName}".`),
      mutated: false,
      clarification: null,
      payload: { error: `Unknown tool "${toolName}".` },
    }
  }

  return definition.execute(input, context)
}

function extractTextReply(message: Anthropic.Messages.Message) {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim()
}

export async function runSecretaryTurn(params: {
  supabase: SupabaseClient
  userId: string
  message: string
  now?: string | null
  timezone?: string | null
  history?: AssistantConversationEntry[]
}): Promise<AssistantMessageResponse> {
  const client = getClaudeClient()

  if (!client) {
    throw new Error("ANTHROPIC_API_KEY is missing. The secretary cannot run until the Claude client is configured.")
  }

  let runtime = await loadAssistantRuntimeContext(params.supabase, params.userId)
  const toolCalls: AssistantToolCallResultInput[] = []
  let clarification: string | null = null
  let needsRefresh = false
  const debugSteps: string[] = []
  const requestTimeZone = params.timezone || runtime.preferences.timezone
  const requestNow = params.now ?? null
  const historyMessages: Anthropic.Messages.MessageParam[] = (params.history || [])
    .filter((entry) => entry.text.trim().length > 0)
    .slice(-8)
    .map((entry) => ({
      role: entry.role,
      content: entry.text.trim(),
    }))
  const messages: Anthropic.Messages.MessageParam[] = [
    ...historyMessages,
    {
      role: "user",
      content: buildInitialUserPrompt(params.message, runtime, {
        now: requestNow,
        timeZone: requestTimeZone,
      }),
    },
  ]

  for (let step = 0; step < DEFAULT_TOOL_STEPS; step += 1) {
    const response = await client.messages.create({
      model: SECRETARY_MODEL,
      max_tokens: 1200,
      temperature: 0,
      system: buildSystemPrompt(runtime, {
        now: requestNow,
        timeZone: requestTimeZone,
      }),
      messages,
      tools: buildToolArray(),
    })

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    )
    const replyText = extractTextReply(response)

    messages.push({
      role: "assistant",
      content: response.content as Anthropic.Messages.ContentBlockParam[],
    })

    if (toolUses.length === 0) {
      runtime = await loadAssistantRuntimeContext(params.supabase, params.userId)

      return assistantMessageResponseSchema.parse({
        ok: true,
        reply: replyText || buildFallbackReply(toolCalls, clarification),
        toolCalls,
        needsRefresh,
        clarification,
        context: runtime.context,
        debug: {
          steps: debugSteps,
          model: SECRETARY_MODEL,
        },
      })
    }

    const toolResults: Anthropic.Messages.ContentBlockParam[] = []

    for (const toolUse of toolUses) {
      const result = await executeToolByName(toolUse.name, toolUse.input, {
        supabase: params.supabase,
        userId: params.userId,
        runtime,
        requestMessage: params.message,
        requestNow,
        requestTimezone: requestTimeZone,
      })

      toolCalls.push(result.receipt)
      debugSteps.push(`${toolUse.name}:${result.receipt.status}`)

      if (result.mutated) {
        needsRefresh = true
        runtime = await loadAssistantRuntimeContext(params.supabase, params.userId)
      }

      if (result.clarification && !clarification) {
        clarification = result.clarification
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: JSON.stringify(result.payload),
      })
    }

    messages.push({
      role: "user",
      content: toolResults,
    })
  }

  runtime = await loadAssistantRuntimeContext(params.supabase, params.userId)

  return assistantMessageResponseSchema.parse({
    ok: false,
    reply: buildFallbackReply(toolCalls, clarification) || "I hit the secretary tool-step limit before finishing that request.",
    toolCalls,
    needsRefresh,
    clarification,
    context: runtime.context,
    error: "The secretary hit the tool-step limit before reaching a final reply.",
    debug: {
      steps: debugSteps,
      model: SECRETARY_MODEL,
    },
  })
}

// ##### END BACKEND #####
