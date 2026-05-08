// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"

import { schedulePlanResultSchema } from "@/schemas/schedule"
import type { AvailabilityWindow, ReplanRequest, SchedulePlanResult, SchedulePreparationContext } from "@/types"

const DEFAULT_TIMEZONE = "America/Chicago"
const DEFAULT_WORKDAY_START = "09:00"
const DEFAULT_WORKDAY_END = "17:00"
const DEFAULT_TASK_DURATION_MINUTES = 50
const DEFAULT_BREAK_MINUTES = 10
const MIN_SLOT_MINUTES = 15
const FIVE_DAY_HORIZON_DAYS = 5
const PLANNER_TOOL_NAME = "return_schedule_plan"
const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6"
const DEFAULT_TASKS_CALENDAR_ID = "cal-tasks"
const IS_DEV = process.env.NODE_ENV !== "production"
const SHOULD_LOG_SCHEDULER_DEBUG =
  IS_DEV && process.env.JARVIS_SCHEDULER_DEBUG !== "0"
const MASTER_SCHEDULING_PROMPT = [
  "You are scheduling tasks onto a calendar for a student productivity assistant.",
  "Think carefully about each task before placing it. Estimate how long the task should take using the task content, the user's preferences, and the rendered memory summary.",
  "Return exactly one tool call with the final schedule plan.",
  "Schedule only the provided schedulable tasks. Fixed tasks are already preserved and must not be moved.",
  "Respect the planning horizon exactly: only place tasks between planningWindow.start and planningWindow.end.",
  "Use the provided availability windows as soft guidance, not as a hard boundary.",
  "Do not place tasks past a deadline or overlapping another event.",
  "Use the rendered memory summary to account for user-specific preferences, habits, and friction points.",
  `All planner-created task events must use calendarId "${DEFAULT_TASKS_CALENDAR_ID}".`,
  "Scheduling outside the preferred availability windows is allowed when needed. If you do that, mention the tradeoff in the summary.",
  "Prefer earlier placement for urgent tasks, align heavier work with stronger energy windows when possible, and leave tasks unscheduled if there is no valid slot.",
  "Each task may appear at most once in placements.",
  "Use ISO timestamps exactly.",
].join("\n")

const plannerToolInputSchema = z.object({
  placements: z
    .array(
      z.object({
        taskId: z.string().uuid(),
        start: z.string().datetime(),
        end: z.string().datetime(),
      }),
    )
    .default([]),
  unscheduledTaskIds: z.array(z.string().uuid()).default([]),
  summary: z.string().min(1).optional(),
})

type PlannerToolInput = z.infer<typeof plannerToolInputSchema>

type PlanningTask = SchedulePreparationContext["tasks"][number] & {
  estimatedDurationMinutes: number
}

type PlanningPreferences = {
  timezone: string
  workdayStart: string
  workdayEnd: string
  defaultTaskDurationMinutes: number
  breakDurationMinutes: number
  preferredFocusBlockMinutes: number | null
  peakEnergyWindow: string | null
  procrastinationPattern: string | null
  sleepPattern: string | null
  preferredCheckInMode: SchedulePreparationContext["preferences"] extends infer T
    ? T extends { preferredCheckInMode: infer Mode }
      ? Mode
      : "quiet"
    : "quiet"
  calendarId: string | null
}

type Interval = {
  startMs: number
  endMs: number
  label: string
}

type PlanningContext = {
  userId: string
  nowIso: string
  timezone: string
  planningWindow: {
    start: string
    end: string
    localStartDay: string
    localEndDay: string
  }
  memoryMarkdown: string
  preferences: PlanningPreferences
  hardEvents: SchedulePlanResult["proposedEvents"]
  fixedTaskEvents: SchedulePlanResult["proposedEvents"]
  fixedTaskIds: Set<string>
  occupiedIntervals: Interval[]
  availabilityWindows: AvailabilityWindow[]
  schedulableTasks: PlanningTask[]
  planningTaskIds: string[]
  taskMap: Map<string, PlanningTask>
}

export function getClaudeClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    return null
  }

  return new Anthropic({ apiKey })
}

export async function generateSchedule(input: SchedulePreparationContext): Promise<SchedulePlanResult> {
  const client = getClaudeClient()

  if (!client) {
    throw new Error("ANTHROPIC_API_KEY is missing. Scheduling cannot run until the Claude client is configured.")
  }

  const planningContext = buildPlanningContext(input)
  planningContext.memoryMarkdown = buildMemorySummaryMarkdown({
    preferences: planningContext.preferences,
    memoryEntries: input.memoryEntries ?? [],
  })

  if (planningContext.planningTaskIds.length === 0) {
    return schedulePlanResultSchema.parse({
      plannerStatus: "ready",
      proposedEvents: sortEventsByStart(planningContext.fixedTaskEvents),
      unscheduledTaskIds: [],
      summary: "No active tasks fell inside the current five-day planning window.",
    })
  }

  if (planningContext.schedulableTasks.length === 0) {
    return schedulePlanResultSchema.parse({
      plannerStatus: "ready",
      proposedEvents: sortEventsByStart(planningContext.fixedTaskEvents),
      unscheduledTaskIds: [],
      summary: "All pending tasks were already fixed in time, so no new scheduling was needed.",
    })
  }

  const plan = await requestClaudeSchedule(client, planningContext)
  const plannedEvents = materializeTaskPlacements(plan, planningContext)
  const proposedEvents = sortEventsByStart([...planningContext.fixedTaskEvents, ...plannedEvents])
  const unscheduledTaskIds = deriveUnscheduledTaskIds(plan, planningContext, plannedEvents)

  validateGeneratedEvents(plannedEvents, planningContext)

  return schedulePlanResultSchema.parse({
    plannerStatus: "ready",
    proposedEvents,
    unscheduledTaskIds,
    summary: plan.summary,
  })
}

export function deriveAvailabilityWindowsFromScheduleContext(input: SchedulePreparationContext): AvailabilityWindow[] {
  return buildPlanningContext(input).availabilityWindows
}

export async function replanSchedule(input: ReplanRequest) {
  const userId =
    input.pendingTasks[0]?.userId ??
    input.preferences?.userId ??
    null

  if (!userId) {
    return {
      success: false,
      reason: input.reason,
      message: "Replan request is missing user context, so the planner could not derive a valid schedule.",
    }
  }

  const schedule = await generateSchedule({
    userId,
    tasks: input.pendingTasks,
    preferences: input.preferences ?? null,
    hardEvents: input.existingEvents.map((event) => ({
      id: event.id,
      userId,
      taskId: event.taskId ?? null,
      title: event.title,
      start: event.start,
      end: event.end,
      source: event.source,
      priority: event.priority ?? "medium",
      status: event.status ?? null,
      location: event.location ?? null,
      externalEventId: event.externalEventId ?? null,
      gcalEventId: event.gcalEventId ?? null,
      lastSyncedFrom: event.lastSyncedFrom ?? "local",
      isImmutable: event.isImmutable ?? true,
      isCheckedIn: event.isCheckedIn ?? false,
      allDay: event.allDay ?? false,
      calendarId: event.calendarId ?? null,
      planId: event.planId ?? null,
    })),
  })

  return {
    success: true,
    reason: input.reason,
    message: "Replan generated from the current task list and existing event constraints.",
    schedule,
  }
}

function buildPlanningContext(input: SchedulePreparationContext): PlanningContext {
  const preferences = normalizePreferences(input)
  const now = roundUpDate(new Date(), MIN_SLOT_MINUTES)
  const nowIso = now.toISOString()
  const planningWindow = getPlanningWindow(now, preferences.timezone)
  const taskMap = new Map<string, PlanningTask>()
  const pendingTasks = input.tasks
    .filter((task) => task.status !== "completed")
    .map((task) => {
      const normalizedTask: PlanningTask = {
        ...task,
        estimatedDurationMinutes: estimateTaskDuration(task, preferences),
      }

      taskMap.set(task.id, normalizedTask)
      return normalizedTask
    })

  const horizonRelevantTasks = pendingTasks.filter((task) =>
    isTaskRelevantToPlanningWindow(task, planningWindow),
  )
  const planningTaskIds = horizonRelevantTasks.map((task) => task.id)

  const fixedTaskEvents = horizonRelevantTasks
    .filter((task) => task.isImmutable && task.scheduledFor)
    .map((task) => taskToFixedEvent(task, input.userId))
    .filter((event) => isEventInsidePlanningWindow(event.start, event.end, planningWindow))
  const hardEvents = input.hardEvents
    .filter((event) => !event.allDay)
    .filter((event) => isEventInsidePlanningWindow(event.start, event.end, planningWindow))

  const fixedTaskIds = new Set(fixedTaskEvents.map((event) => event.taskId).filter((taskId): taskId is string => Boolean(taskId)))
  const occupiedIntervals = [
    ...hardEvents
      .map((event) => ({
        startMs: new Date(event.start).getTime(),
        endMs: new Date(event.end).getTime(),
        label: `hard-event:${event.title}`,
      })),
    ...fixedTaskEvents.map((event) => ({
      startMs: new Date(event.start).getTime(),
      endMs: new Date(event.end).getTime(),
      label: `fixed-task:${event.title}`,
    })),
  ].sort((left, right) => left.startMs - right.startMs)

  const schedulableTasks = sortTasksForPlanning(
    horizonRelevantTasks.filter((task) => !fixedTaskIds.has(task.id)),
    nowIso,
  )

  return {
    userId: input.userId,
    nowIso,
    timezone: preferences.timezone,
    planningWindow,
    memoryMarkdown: "",
    preferences,
    hardEvents,
    fixedTaskEvents,
    fixedTaskIds,
    occupiedIntervals,
    availabilityWindows: buildAvailabilityWindows({
      now,
      planningWindow,
      preferences,
      occupiedIntervals,
    }),
    schedulableTasks,
    planningTaskIds,
    taskMap,
  }
}

async function requestClaudeSchedule(client: Anthropic, context: PlanningContext): Promise<PlannerToolInput> {
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL
  const promptPayload = buildPromptPayload(context)

  logSchedulerDebug({
    model,
    systemPrompt: MASTER_SCHEDULING_PROMPT,
    memoryMarkdown: context.memoryMarkdown,
    availabilityWindows: context.availabilityWindows,
    hardEvents: context.hardEvents.map((event) => ({
      title: event.title,
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      location: event.location,
      calendarId: event.calendarId,
    })),
    fixedTaskEvents: context.fixedTaskEvents.map((event) => ({
      taskId: event.taskId,
      title: event.title,
      start: event.start,
      end: event.end,
      calendarId: event.calendarId,
    })),
    schedulableTasks: context.schedulableTasks.map((task) => ({
      id: task.id,
      title: task.title,
      deadline: task.deadline,
      priority: task.priority,
      estimatedDurationMinutes: task.estimatedDurationMinutes,
      allDay: task.allDay,
      calendarId: task.calendarId,
    })),
    promptPayload,
  })

  const message = await client.messages.create({
    model,
    max_tokens: 1600,
    temperature: 0,
    system: MASTER_SCHEDULING_PROMPT,
    messages: [
      {
        role: "user",
        content: JSON.stringify(promptPayload, null, 2),
      },
    ],
    tools: [
      {
        name: PLANNER_TOOL_NAME,
        description: "Return the final schedule placements and unscheduled tasks.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            placements: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  taskId: { type: "string", format: "uuid" },
                  start: { type: "string", format: "date-time" },
                  end: { type: "string", format: "date-time" },
                },
                required: ["taskId", "start", "end"],
              },
            },
            unscheduledTaskIds: {
              type: "array",
              items: { type: "string", format: "uuid" },
            },
            summary: { type: "string" },
          },
          required: ["placements", "unscheduledTaskIds"],
        },
      },
    ],
    tool_choice: {
      type: "tool",
      name: PLANNER_TOOL_NAME,
      disable_parallel_tool_use: true,
    },
  })

  const toolUseBlock = message.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === PLANNER_TOOL_NAME,
  )

  if (!toolUseBlock) {
    throw new Error("Claude did not return the required schedule planning tool payload.")
  }

  const toolInput =
    toolUseBlock.input && typeof toolUseBlock.input === "object" ? toolUseBlock.input : {}

  return plannerToolInputSchema.parse({
    ...toolInput,
    summary: getPlannerSummary(toolInput),
  })
}

function getPlannerSummary(input: unknown) {
  if (
    input &&
    typeof input === "object" &&
    "summary" in input &&
    typeof input.summary === "string" &&
    input.summary.trim().length > 0
  ) {
    return input.summary.trim()
  }

  const placements =
    input &&
    typeof input === "object" &&
    "placements" in input &&
    Array.isArray(input.placements)
      ? input.placements.length
      : 0
  const unscheduled =
    input &&
    typeof input === "object" &&
    "unscheduledTaskIds" in input &&
    Array.isArray(input.unscheduledTaskIds)
      ? input.unscheduledTaskIds.length
      : 0

  if (placements > 0 && unscheduled > 0) {
    return `Scheduled ${placements} task${placements === 1 ? "" : "s"} and left ${unscheduled} unscheduled.`
  }

  if (placements > 0) {
    return `Scheduled ${placements} task${placements === 1 ? "" : "s"}.`
  }

  if (unscheduled > 0) {
    return `No valid placements were found; ${unscheduled} task${unscheduled === 1 ? "" : "s"} remained unscheduled.`
  }

  return "Claude returned an empty schedule plan."
}

function buildPromptPayload(context: PlanningContext) {
  return {
    currentTime: context.nowIso,
    timezone: context.timezone,
    planningWindow: context.planningWindow,
    memoryMarkdown: context.memoryMarkdown,
    preferences: {
      timezone: context.preferences.timezone,
      workdayStart: context.preferences.workdayStart,
      workdayEnd: context.preferences.workdayEnd,
      defaultTaskDurationMinutes: context.preferences.defaultTaskDurationMinutes,
      breakDurationMinutes: context.preferences.breakDurationMinutes,
      preferredFocusBlockMinutes: context.preferences.preferredFocusBlockMinutes,
      peakEnergyWindow: context.preferences.peakEnergyWindow,
      procrastinationPattern: context.preferences.procrastinationPattern,
      sleepPattern: context.preferences.sleepPattern,
      preferredCheckInMode: context.preferences.preferredCheckInMode,
      preferredCalendarId: context.preferences.calendarId,
      defaultCalendarId: DEFAULT_TASKS_CALENDAR_ID,
    },
    fixedTaskEvents: context.fixedTaskEvents.map((event) => ({
      taskId: event.taskId,
      title: event.title,
      start: event.start,
      end: event.end,
      calendarId: event.calendarId,
    })),
    availabilityWindows: context.availabilityWindows,
    tasks: context.schedulableTasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      deadline: task.deadline,
      priority: task.priority,
      status: task.status,
      tags: task.tags,
      estimatedDurationMinutes: task.estimatedDurationMinutes,
      scheduledForHint: task.scheduledFor,
      isImmutable: task.isImmutable,
      calendarId: DEFAULT_TASKS_CALENDAR_ID,
    })),
  }
}

function materializeTaskPlacements(
  plan: PlannerToolInput,
  context: PlanningContext,
): SchedulePlanResult["proposedEvents"] {
  const seenTaskIds = new Set<string>()

  return plan.placements.map((placement) => {
    const task = context.taskMap.get(placement.taskId)

    if (!task) {
      throw new Error(`Claude scheduled an unknown task id: ${placement.taskId}`)
    }

    if (context.fixedTaskIds.has(task.id)) {
      throw new Error(`Claude attempted to reschedule immutable task ${task.id}.`)
    }

    if (seenTaskIds.has(task.id)) {
      throw new Error(`Claude scheduled task ${task.id} more than once.`)
    }

    seenTaskIds.add(task.id)

    return {
      id: crypto.randomUUID(),
      userId: context.userId,
      taskId: task.id,
      title: task.title,
      start: placement.start,
      end: placement.end,
      source: "task" as const,
      priority: task.priority,
      status: "scheduled" as const,
      location: null,
      externalEventId: null,
      gcalEventId: null,
      lastSyncedFrom: "local" as const,
      isImmutable: task.isImmutable,
      isCheckedIn: false,
      allDay: task.allDay,
      calendarId: DEFAULT_TASKS_CALENDAR_ID,
      planId: null,
    }
  })
}

function deriveUnscheduledTaskIds(
  plan: PlannerToolInput,
  context: PlanningContext,
  plannedEvents: SchedulePlanResult["proposedEvents"],
): string[] {
  const scheduledTaskIds = new Set(plannedEvents.map((event) => event.taskId).filter((taskId): taskId is string => Boolean(taskId)))
  const unscheduled = new Set(plan.unscheduledTaskIds)

  for (const task of context.schedulableTasks) {
    if (!scheduledTaskIds.has(task.id)) {
      unscheduled.add(task.id)
    }
  }

  for (const fixedTaskId of context.fixedTaskIds) {
    unscheduled.delete(fixedTaskId)
  }

  return Array.from(unscheduled).sort()
}

function validateGeneratedEvents(
  plannedEvents: SchedulePlanResult["proposedEvents"],
  context: PlanningContext,
) {
  const occupiedIntervals = [...context.occupiedIntervals]

  for (const event of plannedEvents) {
    const startMs = new Date(event.start).getTime()
    const endMs = new Date(event.end).getTime()

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      throw new Error(`Claude returned an invalid time range for task ${event.taskId}.`)
    }

    const task = event.taskId ? context.taskMap.get(event.taskId) : null

    if (!task) {
      throw new Error(`Missing task context while validating event ${event.id}.`)
    }

    if (startMs < new Date(context.nowIso).getTime()) {
      throw new Error(`Claude scheduled task ${task.id} in the past.`)
    }

    if (!isEventInsidePlanningWindow(event.start, event.end, context.planningWindow)) {
      throw new Error(`Claude scheduled task ${task.id} outside the five-day planning horizon.`)
    }

    if (task.deadline && endMs > new Date(task.deadline).getTime()) {
      throw new Error(`Claude scheduled task ${task.id} past its deadline.`)
    }

    const overlap = occupiedIntervals.find(
      (interval) => startMs < interval.endMs && endMs > interval.startMs,
    )

    if (overlap) {
      throw new Error(`Claude scheduled task ${task.id} on top of ${overlap.label}.`)
    }

    occupiedIntervals.push({
      startMs,
      endMs,
      label: `planned-task:${task.title}`,
    })
  }
}

function normalizePreferences(input: SchedulePreparationContext): PlanningPreferences {
  return {
    timezone: input.preferences?.timezone || DEFAULT_TIMEZONE,
    workdayStart: input.preferences?.workdayStart || DEFAULT_WORKDAY_START,
    workdayEnd: input.preferences?.workdayEnd || DEFAULT_WORKDAY_END,
    defaultTaskDurationMinutes:
      input.preferences?.defaultTaskDurationMinutes || DEFAULT_TASK_DURATION_MINUTES,
    breakDurationMinutes: input.preferences?.breakDurationMinutes ?? DEFAULT_BREAK_MINUTES,
    preferredFocusBlockMinutes: input.preferences?.preferredFocusBlockMinutes ?? null,
    peakEnergyWindow: input.preferences?.peakEnergyWindow ?? null,
    procrastinationPattern: input.preferences?.procrastinationPattern ?? null,
    sleepPattern: input.preferences?.sleepPattern ?? null,
    preferredCheckInMode: input.preferences?.preferredCheckInMode ?? "quiet",
    calendarId: input.preferences?.calendarId ?? null,
  }
}

function estimateTaskDuration(
  task: SchedulePreparationContext["tasks"][number],
  preferences: PlanningPreferences,
) {
  if (task.durationMinutes && task.durationMinutes > 0) {
    return task.durationMinutes
  }

  const text = [task.title, task.description ?? "", task.tags.join(" ")]
    .join(" ")
    .toLowerCase()

  if (/(email|reply|submit|form|admin|registration|check.?in|follow up)/.test(text)) {
    return 30
  }

  if (/(read|review|notes|slides|flashcards|quiz)/.test(text)) {
    return 45
  }

  if (/(essay|paper|write|draft|research|project|problem set|pset|study)/.test(text)) {
    return preferences.preferredFocusBlockMinutes ?? 90
  }

  if (task.priority === "high") {
    return Math.max(preferences.defaultTaskDurationMinutes, 60)
  }

  if (task.priority === "low") {
    return Math.min(preferences.defaultTaskDurationMinutes, 45)
  }

  return preferences.defaultTaskDurationMinutes
}

function taskToFixedEvent(
  task: PlanningTask,
  userId: string,
): SchedulePlanResult["proposedEvents"][number] {
  const startMs = new Date(task.scheduledFor as string).getTime()
  const endMs = startMs + task.estimatedDurationMinutes * 60_000

  return {
    id: crypto.randomUUID(),
    userId,
    taskId: task.id,
    title: task.title,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    source: "task",
    priority: task.priority,
    status: "scheduled",
    location: null,
    externalEventId: null,
    gcalEventId: null,
    lastSyncedFrom: "local",
    isImmutable: true,
    isCheckedIn: false,
    allDay: task.allDay,
    calendarId: DEFAULT_TASKS_CALENDAR_ID,
    planId: task.planId,
  }
}

type MemorySummaryInput = {
  preferences: PlanningPreferences
  memoryEntries: Array<{
    category?: string | null
    insight: string
    confidence?: number | null
    source?: string | null
  }>
}

export function buildMemorySummaryMarkdown(input: MemorySummaryInput) {
  const { preferences, memoryEntries } = input
  const sections: string[] = [
    "# User Scheduling Memory",
    "",
    "## Structured Preferences",
    `- Timezone: ${preferences.timezone}`,
    `- Scheduling hours: ${preferences.workdayStart} to ${preferences.workdayEnd}`,
    `- Default work block length: ${preferences.defaultTaskDurationMinutes} minutes`,
    `- Preferred break length: ${preferences.breakDurationMinutes} minutes`,
    `- Preferred check-in mode: ${preferences.preferredCheckInMode}`,
  ]

  if (preferences.preferredFocusBlockMinutes) {
    sections.push(`- Preferred focus block length: ${preferences.preferredFocusBlockMinutes} minutes`)
  }

  if (preferences.calendarId) {
    sections.push(`- Preferred calendar reference: ${preferences.calendarId}`)
  }

  const narrativeNotes: string[] = []

  if (preferences.sleepPattern) {
    narrativeNotes.push(`Sleep / no-disturb note: ${preferences.sleepPattern}`)
  }

  if (preferences.peakEnergyWindow) {
    narrativeNotes.push(`Peak energy window: ${preferences.peakEnergyWindow}`)
  }

  if (preferences.procrastinationPattern) {
    narrativeNotes.push(`Procrastination pattern: ${preferences.procrastinationPattern}`)
  }

  if (narrativeNotes.length > 0) {
    sections.push("", "## Persistent Scheduling Notes")

    for (const note of narrativeNotes) {
      sections.push(`- ${note}`)
    }
  }

  const normalizedMemoryEntries = memoryEntries
    .filter((entry) => entry.insight.trim().length > 0)
    .sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0))

  if (normalizedMemoryEntries.length > 0) {
    sections.push("", "## Additional Memory")

    for (const entry of normalizedMemoryEntries) {
      const meta: string[] = []

      if (entry.category) {
        meta.push(entry.category)
      }

      if (typeof entry.confidence === "number") {
        meta.push(`confidence ${entry.confidence.toFixed(2)}`)
      }

      if (entry.source) {
        meta.push(entry.source)
      }

      sections.push(
        meta.length > 0
          ? `- ${entry.insight} (${meta.join(", ")})`
          : `- ${entry.insight}`,
      )
    }
  }

  sections.push(
    "",
    `## Planner Rules`,
    `- All newly scheduled task events must use calendarId "${DEFAULT_TASKS_CALENDAR_ID}".`,
    "- Treat structured preferences as durable user guidance.",
    "- Treat narrative notes as soft memory unless they conflict with hard availability windows already provided.",
  )

  return sections.join("\n").trim()
}

function logSchedulerDebug(payload: {
  model: string
  systemPrompt: string
  memoryMarkdown: string
  availabilityWindows: AvailabilityWindow[]
  hardEvents: Array<{
    title: string
    start: string
    end: string
    allDay: boolean
    location: string | null
    calendarId: string | null
  }>
  fixedTaskEvents: Array<{
    taskId: string | null
    title: string
    start: string
    end: string
    calendarId: string | null
  }>
  schedulableTasks: Array<{
    id: string
    title: string
    deadline: string | null
    priority: SchedulePreparationContext["tasks"][number]["priority"]
    estimatedDurationMinutes: number
    allDay: boolean
    calendarId: string | null
  }>
  promptPayload: ReturnType<typeof buildPromptPayload>
}) {
  if (!SHOULD_LOG_SCHEDULER_DEBUG) {
    return
  }

  console.log(
    "[scheduler-debug]",
    JSON.stringify(payload, null, 2),
  )
}

function buildAvailabilityWindows(args: {
  now: Date
  planningWindow: PlanningContext["planningWindow"]
  preferences: PlanningPreferences
  occupiedIntervals: Interval[]
}) {
  const { now, planningWindow, preferences, occupiedIntervals } = args
  const windows: AvailabilityWindow[] = []

  for (let offset = 0; offset < FIVE_DAY_HORIZON_DAYS; offset += 1) {
    const localDay = addDaysToDateKey(planningWindow.localStartDay, offset)
    const workStart = zonedDateTimeToUtc(localDay, preferences.workdayStart, preferences.timezone)
    const workEnd = zonedDateTimeToUtc(localDay, preferences.workdayEnd, preferences.timezone)
    const dayStartMs = Math.max(workStart.getTime(), now.getTime())
    const dayEndMs = Math.min(workEnd.getTime(), new Date(planningWindow.end).getTime())

    if (dayEndMs <= dayStartMs) {
      continue
    }

    const overlappingIntervals = occupiedIntervals.filter(
      (interval) => interval.startMs < dayEndMs && interval.endMs > dayStartMs,
    )
    const freeIntervals = subtractIntervals(dayStartMs, dayEndMs, overlappingIntervals)

    for (const interval of freeIntervals) {
      windows.push({
        start: new Date(interval.startMs).toISOString(),
        end: new Date(interval.endMs).toISOString(),
        localDay,
        durationMinutes: Math.round((interval.endMs - interval.startMs) / 60_000),
      })
    }
  }

  return windows
}

function sortTasksForPlanning(tasks: PlanningTask[], nowIso: string) {
  return [...tasks].sort((left, right) => {
    const leftScore = getTaskUrgencyScore(left, nowIso)
    const rightScore = getTaskUrgencyScore(right, nowIso)

    return rightScore - leftScore
  })
}

function getTaskUrgencyScore(task: PlanningTask, nowIso: string) {
  let score = 0

  if (task.priority === "high") score += 300
  if (task.priority === "medium") score += 150
  if (task.status === "missed") score += 120

  if (task.deadline) {
    const hoursUntilDeadline = (new Date(task.deadline).getTime() - new Date(nowIso).getTime()) / 3_600_000

    if (hoursUntilDeadline <= 24) score += 200
    else if (hoursUntilDeadline <= 72) score += 120
    else if (hoursUntilDeadline <= 168) score += 60
  }

  return score
}

function subtractIntervals(startMs: number, endMs: number, intervals: Interval[]) {
  const sortedIntervals = [...intervals].sort((left, right) => left.startMs - right.startMs)
  const freeIntervals: Array<{ startMs: number; endMs: number }> = []
  let cursor = startMs

  for (const interval of sortedIntervals) {
    if (interval.endMs <= cursor) {
      continue
    }

    if (interval.startMs > cursor) {
      freeIntervals.push({
        startMs: cursor,
        endMs: Math.min(interval.startMs, endMs),
      })
    }

    cursor = Math.max(cursor, interval.endMs)

    if (cursor >= endMs) {
      break
    }
  }

  if (cursor < endMs) {
    freeIntervals.push({ startMs: cursor, endMs })
  }

  return freeIntervals.filter(
    (interval) => interval.endMs - interval.startMs >= MIN_SLOT_MINUTES * 60_000,
  )
}

function roundUpDate(date: Date, minuteIncrement: number) {
  const rounded = new Date(date)
  const ms = rounded.getTime()
  const incrementMs = minuteIncrement * 60_000
  const roundedMs = Math.ceil(ms / incrementMs) * incrementMs

  rounded.setTime(roundedMs)
  rounded.setSeconds(0, 0)

  return rounded
}

function getLocalDateKey(date: Date, timeZone: string) {
  const formatter = getDateTimeFormatter(
    `date:${timeZone}`,
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

function getOffsetMinutes(date: Date, timeZone: string) {
  const formatter = getDateTimeFormatter(
    `offset:${timeZone}`,
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

function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  const nextYear = next.getUTCFullYear()
  const nextMonth = String(next.getUTCMonth() + 1).padStart(2, "0")
  const nextDay = String(next.getUTCDate()).padStart(2, "0")

  return `${nextYear}-${nextMonth}-${nextDay}`
}

function sortEventsByStart(events: SchedulePlanResult["proposedEvents"]) {
  return [...events].sort(
    (left, right) => new Date(left.start).getTime() - new Date(right.start).getTime(),
  )
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function getDateTimeFormatter(cacheKey: string, formatter: Intl.DateTimeFormat) {
  const existing = formatterCache.get(cacheKey)

  if (existing) {
    return existing
  }

  formatterCache.set(cacheKey, formatter)
  return formatter
}

function getPlanningWindow(now: Date, timeZone: string) {
  const localStartDay = getLocalDateKey(now, timeZone)
  const localEndDay = addDaysToDateKey(localStartDay, FIVE_DAY_HORIZON_DAYS - 1)
  const endOfDay = zonedDateTimeToUtc(localEndDay, "23:59", timeZone)
  const inclusiveEnd = new Date(endOfDay.getTime() + 59_999)

  return {
    start: now.toISOString(),
    end: inclusiveEnd.toISOString(),
    localStartDay,
    localEndDay,
  }
}

function isTaskRelevantToPlanningWindow(
  task: PlanningTask,
  planningWindow: PlanningContext["planningWindow"],
) {
  if (task.scheduledFor && isTimestampInsidePlanningWindow(task.scheduledFor, planningWindow)) {
    return true
  }

  if (task.isImmutable && task.scheduledFor) {
    return isTimestampInsidePlanningWindow(task.scheduledFor, planningWindow)
  }

  if (task.deadline === null) {
    return true
  }

  return new Date(task.deadline).getTime() <= new Date(planningWindow.end).getTime()
}

function isTimestampInsidePlanningWindow(
  timestamp: string,
  planningWindow: PlanningContext["planningWindow"],
) {
  const value = new Date(timestamp).getTime()

  return (
    Number.isFinite(value) &&
    value >= new Date(planningWindow.start).getTime() &&
    value <= new Date(planningWindow.end).getTime()
  )
}

function isEventInsidePlanningWindow(
  start: string,
  end: string,
  planningWindow: PlanningContext["planningWindow"],
) {
  const startMs = new Date(start).getTime()
  const endMs = new Date(end).getTime()
  const windowStartMs = new Date(planningWindow.start).getTime()
  const windowEndMs = new Date(planningWindow.end).getTime()

  return (
    Number.isFinite(startMs) &&
    Number.isFinite(endMs) &&
    endMs > windowStartMs &&
    startMs < windowEndMs
  )
}

// ##### END BACKEND #####
