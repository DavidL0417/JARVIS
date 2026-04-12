// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import type Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"

import { getClaudeClient } from "@/lib/ai/claude"
import {
  createFallbackParsedAssistantInput,
  parsedAssistantInputSchema,
  type AssistantIntent,
  type AssistantMessageRequest,
  type AssistantParserErrorCode,
  type AssistantParserStage,
  type ParsedAssistantInput,
} from "@/lib/ai/parser-schema"

const CLAUDE_PARSER_MODEL = "claude-sonnet-4-6"
const IS_DEV = process.env.NODE_ENV !== "production"

type ClaudeMessagesCreateResponse = Awaited<ReturnType<Anthropic["messages"]["create"]>>

export type AssistantParseResult = {
  parsed: ParsedAssistantInput
  parserStage: AssistantParserStage
  errorCode?: AssistantParserErrorCode
}

const CLAUDE_PARSER_SYSTEM_PROMPT = `You are the input parser for a scheduling assistant.

Your job is to convert a user's plain-language message into exactly one structured JSON object for downstream application logic.

You are NOT the scheduler.
You are NOT a chatbot.
You do NOT explain your reasoning.
You do NOT add conversational filler.
You do NOT invent dates, times, durations, priorities, task names, or IDs.

You must:
1. Classify the message into exactly one primary intent.
2. Extract only information explicitly stated or strongly implied.
3. Distinguish between mutable tasks, fixed events, replanning requests, task edits, and memory/preferences.
4. Mark \`event.all_day\` true only when the user clearly indicates all-day event intent.
5. If information is missing or ambiguous, set \`needs_clarification\` to true and briefly explain why in \`clarification_reason\`.
6. Return exactly one JSON object matching the required schema.
7. If the message contains multiple actions, include the extras in \`secondary_intents\`.
8. Calendar import is out of scope. Only parse direct user input.

Interpretation rules:
- A task is generally something the assistant may schedule flexibly.
- Use \`create_fixed_event\` for calendar-like commitments and timeboxed event blocks.
- Set \`event.is_immutable\` to true for hard commitments that should not be auto-moved.
- Set \`event.is_immutable\` to false for flexible timeboxed blocks like workouts, study blocks, or focus blocks.
- If the user explicitly says "all day" for an event, mark \`event.all_day: true\`.
- For tasks, do not use all-day mode. If the user gives a day or date but no time, treat it as a normal task due by the end of that day.
- If the user provides a day or date but no time for an event, assume the event is all day rather than asking for a time.
- A real-world commitment tied to a date, day, person, or place should usually be treated as a fixed event, even if no exact start time is given.
- Social plans, appointments, meetings, dinners, shopping trips, and hangouts tied to dates are usually fixed events.
- Homework, studying, chores, cleaning, project work, and things to complete are usually tasks.
- Do not assume all direct user input is a task.
- Do not assume all timed inputs are flexible.
- Missing optional details should not force \`unknown\`.
- Do not overuse \`unknown\`. Prefer the best-fit classification when intent is reasonably clear.
- Only use \`unknown\` when the message truly cannot be mapped.
- When uncertain, preserve ambiguity instead of guessing details.

Few-shot examples:
Example A input:
"Schedule shopping with Cindy for April 12"
Example A output:
{"primary_intent":"create_fixed_event","secondary_intents":[],"needs_clarification":false,"clarification_reason":null,"user_facing_summary":"This looks like an all-day fixed event request for shopping with Cindy.","task":{"title":null,"duration_minutes":null,"due_at":null,"priority":null,"tags":[],"all_day":false,"is_immutable":false},"event":{"title":"Shopping with Cindy","start_at":"April 12","end_at":null,"calendar_id":null,"all_day":true,"is_immutable":true},"task_edit":{"target_task_text":null,"operation":null,"new_value":null},"memory":{"operation":null,"content":null}}

Example B input:
"Dinner with Evan tomorrow"
Example B output:
{"primary_intent":"create_fixed_event","secondary_intents":[],"needs_clarification":false,"clarification_reason":null,"user_facing_summary":"This looks like an all-day fixed event request for dinner with Evan.","task":{"title":null,"duration_minutes":null,"due_at":null,"priority":null,"tags":[],"all_day":false,"is_immutable":false},"event":{"title":"Dinner with Evan","start_at":"tomorrow","end_at":null,"calendar_id":null,"all_day":true,"is_immutable":true},"task_edit":{"target_task_text":null,"operation":null,"new_value":null},"memory":{"operation":null,"content":null}}

Example C input:
"Doctor appointment Tuesday at 3 PM"
Example C output:
{"primary_intent":"create_fixed_event","secondary_intents":[],"needs_clarification":false,"clarification_reason":null,"user_facing_summary":"This looks like a fixed event request for a doctor appointment.","task":{"title":null,"duration_minutes":null,"due_at":null,"priority":null,"tags":[],"all_day":false,"is_immutable":false},"event":{"title":"Doctor appointment","start_at":"Tuesday at 3 PM","end_at":null,"calendar_id":null,"all_day":false,"is_immutable":true},"task_edit":{"target_task_text":null,"operation":null,"new_value":null},"memory":{"operation":null,"content":null}}

Example D input:
"Finish CS213 homework tomorrow night"
Example D output:
{"primary_intent":"create_task","secondary_intents":[],"needs_clarification":false,"clarification_reason":null,"user_facing_summary":"This looks like a task creation request.","task":{"title":"Finish CS213 homework","duration_minutes":null,"due_at":"tomorrow night","priority":null,"tags":["CS213"],"all_day":false,"is_immutable":false},"event":{"title":null,"start_at":null,"end_at":null,"calendar_id":null,"all_day":false,"is_immutable":true},"task_edit":{"target_task_text":null,"operation":null,"new_value":null},"memory":{"operation":null,"content":null}}

Example E input:
"Remember that I focus better at night"
Example E output:
{"primary_intent":"remember_preference","secondary_intents":[],"needs_clarification":false,"clarification_reason":null,"user_facing_summary":"This looks like a memory or preference update.","task":{"title":null,"duration_minutes":null,"due_at":null,"priority":null,"tags":[],"all_day":false,"is_immutable":false},"event":{"title":null,"start_at":null,"end_at":null,"calendar_id":null,"all_day":false,"is_immutable":true},"task_edit":{"target_task_text":null,"operation":null,"new_value":null},"memory":{"operation":"remember","content":"I focus better at night"}}

Example F input:
"Workout tomorrow morning"
Example F output:
{"primary_intent":"create_fixed_event","secondary_intents":[],"needs_clarification":false,"clarification_reason":null,"user_facing_summary":"This looks like a flexible time block request for a workout.","task":{"title":null,"duration_minutes":null,"due_at":null,"priority":null,"tags":[],"all_day":false,"is_immutable":false},"event":{"title":"Workout","start_at":"tomorrow morning","end_at":null,"calendar_id":null,"all_day":false,"is_immutable":false},"task_edit":{"target_task_text":null,"operation":null,"new_value":null},"memory":{"operation":null,"content":null}}

Example G input:
"Vacation all day on April 12"
Example G output:
{"primary_intent":"create_fixed_event","secondary_intents":[],"needs_clarification":false,"clarification_reason":null,"user_facing_summary":"This looks like an all-day event request.","task":{"title":null,"duration_minutes":null,"due_at":null,"priority":null,"tags":[],"all_day":false,"is_immutable":false},"event":{"title":"Vacation","start_at":"April 12","end_at":null,"calendar_id":null,"all_day":true,"is_immutable":true},"task_edit":{"target_task_text":null,"operation":null,"new_value":null},"memory":{"operation":null,"content":null}}

Example H input:
"Work on taxes all day tomorrow"
Example H output:
{"primary_intent":"create_task","secondary_intents":[],"needs_clarification":false,"clarification_reason":null,"user_facing_summary":"This looks like a task request due by the end of tomorrow.","task":{"title":"Work on taxes","duration_minutes":null,"due_at":"tomorrow","priority":null,"tags":[],"all_day":false,"is_immutable":false},"event":{"title":null,"start_at":null,"end_at":null,"calendar_id":null,"all_day":false,"is_immutable":true},"task_edit":{"target_task_text":null,"operation":null,"new_value":null},"memory":{"operation":null,"content":null}}

Example I input:
"Finish CS213 homework on April 16"
Example I output:
{"primary_intent":"create_task","secondary_intents":[],"needs_clarification":false,"clarification_reason":null,"user_facing_summary":"This looks like a task request due by the end of April 16.","task":{"title":"Finish CS213 homework","duration_minutes":null,"due_at":"April 16","priority":null,"tags":["CS213"],"all_day":false,"is_immutable":false},"event":{"title":null,"start_at":null,"end_at":null,"calendar_id":null,"all_day":false,"is_immutable":true},"task_edit":{"target_task_text":null,"operation":null,"new_value":null},"memory":{"operation":null,"content":null}}

Output rules:
- Return JSON only.
- No markdown.
- No prose outside the JSON object.
- All omitted information must be null or an empty array according to schema.`

function buildParserUserPrompt(input: AssistantMessageRequest) {
  return [
    "Parse the following user request into the required JSON schema.",
    "",
    `Current timestamp: ${input.now ?? "not provided"}`,
    `Timezone: ${input.timezone ?? "not provided"}`,
    `Current local day: ${input.currentDay ?? "not provided"}`,
    "",
    "Use the current local day when resolving words like today, tomorrow, tonight, or weekdays.",
    "Normalize relative time only if enough context exists. If not, preserve the relative wording and request clarification where helpful.",
    "",
    "User message:",
    JSON.stringify(input.message),
  ].join("\n")
}

function logDevDebug(label: string, value: unknown) {
  if (!IS_DEV) {
    return
  }

  console.log(`[assistant-parser] ${label}`, value)
}

function extractTextContent(response: ClaudeMessagesCreateResponse) {
  if (!("content" in response) || !Array.isArray(response.content)) {
    return ""
  }

  return response.content
    .filter(
      (block): block is Extract<(typeof response.content)[number], { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("\n")
    .trim()
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim()

  if (!trimmed) {
    return null
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed
  }

  let depth = 0
  let startIndex = -1
  let inString = false
  let isEscaped = false

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index]

    if (inString) {
      if (isEscaped) {
        isEscaped = false
      } else if (char === "\\") {
        isEscaped = true
      } else if (char === "\"") {
        inString = false
      }

      continue
    }

    if (char === "\"") {
      inString = true
      continue
    }

    if (char === "{") {
      if (depth === 0) {
        startIndex = index
      }

      depth += 1
      continue
    }

    if (char === "}") {
      depth -= 1

      if (depth === 0 && startIndex !== -1) {
        return trimmed.slice(startIndex, index + 1)
      }
    }
  }

  return null
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function normalizeIntent(value: unknown): AssistantIntent | null {
  if (typeof value !== "string") {
    return null
  }

  const normalized = value.trim().toLowerCase()

  if (
    normalized === "create_task" ||
    normalized === "create_fixed_event" ||
    normalized === "replan" ||
    normalized === "edit_task" ||
    normalized === "remember_preference" ||
    normalized === "forget_memory" ||
    normalized === "unknown"
  ) {
    return normalized
  }

  return null
}

function normalizePriority(value: unknown): "low" | "medium" | "high" | null {
  if (value === "low" || value === "medium" || value === "high") {
    return value
  }

  return null
}

function normalizeTaskEditOperation(value: unknown) {
  if (
    value === "rename" ||
    value === "complete" ||
    value === "delete" ||
    value === "change_due_date" ||
    value === "change_priority" ||
    value === "change_duration"
  ) {
    return value
  }

  return null
}

function normalizeMemoryOperation(value: unknown) {
  if (value === "remember" || value === "forget") {
    return value
  }

  return null
}

function inferIntentFromMessage(message: string): AssistantIntent {
  const normalized = message.toLowerCase()

  if (/(remember|from now on|prefer|usually|focus better)/.test(normalized)) {
    return "remember_preference"
  }

  if (/(forget|stop remembering|remove memory)/.test(normalized)) {
    return "forget_memory"
  }

  if (/(rename|mark .* complete|complete\b|delete task|remove task|update task|change\b)/.test(normalized)) {
    return "edit_task"
  }

  if (/(replan|reschedule|move\b|running late|can't do|cant do|today changed)/.test(normalized)) {
    return "replan"
  }

  const hasTimeOrDateCue =
    /(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\bon\b|\bat\b|\bfor\b)/.test(
      normalized,
    )

  const eventLike =
    /(appointment|meeting|dinner|lunch|breakfast|shopping|hangout|trip|concert|party|doctor|dentist|class|call|with\s+[a-z]+)/.test(
      normalized,
    )
  const flexibleEventBlockLike =
    /(workout|gym|exercise|study block|focus block|deep work|work block)/.test(normalized)

  if ((eventLike || flexibleEventBlockLike) && hasTimeOrDateCue) {
    return "create_fixed_event"
  }

  if (
    /(finish|homework|study|studying|clean|laundry|chore|assignment|project|work on|need to|submit|write|read)/.test(
      normalized,
    )
  ) {
    return "create_task"
  }

  return "unknown"
}

function deriveTitleFromMessage(message: string, intent: AssistantIntent): string | null {
  const trimmed = message.trim()

  if (!trimmed) {
    return null
  }

  let normalized = trimmed
    .replace(/^(schedule|add|create|plan|put)\s+/i, "")
    .replace(/^(i have|i'm having|im having|going to)\s+/i, "")
    .replace(/^(remember that)\s+/i, "")

  const temporalCueMatch = normalized.match(
    /\s+(for|on|at)\s+.+$|\s+(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b.*$/i,
  )

  if (temporalCueMatch?.index !== undefined && temporalCueMatch.index > 0) {
    normalized = normalized.slice(0, temporalCueMatch.index)
  }

  const title = normalized.replace(/\s+/g, " ").trim()

  if (!title) {
    return null
  }

  if (intent === "create_fixed_event") {
    return title.replace(/\bshopping\b/i, "Shopping").replace(/\bwith\b/i, "with")
  }

  return title
}

function buildSummary(intent: AssistantIntent): string {
  switch (intent) {
    case "create_task":
      return "This looks like a task creation request."
    case "create_fixed_event":
      return "This looks like a fixed event request."
    case "replan":
      return "This looks like a replan request."
    case "edit_task":
      return "This looks like a task edit request."
    case "remember_preference":
      return "This looks like a memory or preference update."
    case "forget_memory":
      return "This looks like a memory removal request."
    default:
      return "I could not confidently parse that request."
  }
}

function hasAllDayCue(message: string): boolean {
  return /\ball day\b/.test(message.toLowerCase())
}

function hasExplicitTimeCue(message: string | null | undefined): boolean {
  if (!message) {
    return false
  }

  return /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\bnoon\b|\bmidnight\b|\bmorning\b|\bafternoon\b|\bevening\b|\btonight\b|\bnight\b/i.test(
    message,
  )
}

function extractTemporalPhrase(message: string) {
  const temporalPhrase = message.match(
    /\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december\b.*|\b\d{1,2}(:\d{2})?\s?(am|pm)\b.*)/i,
  )

  return temporalPhrase ? temporalPhrase[0].trim() : null
}

function inferEventImmutability(message: string): boolean {
  const normalized = message.toLowerCase()

  if (/(workout|gym|exercise|study block|focus block|deep work|work block)/.test(normalized)) {
    return false
  }

  if (
    /(appointment|meeting|dinner|lunch|breakfast|shopping|hangout|trip|concert|party|doctor|dentist|class|call|with\s+[a-z]+)/.test(
      normalized,
    )
  ) {
    return true
  }

  return true
}

function normalizeParsedAssistantInput(payload: unknown, rawMessage: string): ParsedAssistantInput {
  const fallback = createFallbackParsedAssistantInput()
  const objectPayload = payload && typeof payload === "object" ? payload : {}
  const inferredIntent = inferIntentFromMessage(rawMessage)

  const taskPayload =
    "task" in objectPayload && objectPayload.task && typeof objectPayload.task === "object"
      ? objectPayload.task
      : {}
  const eventPayload =
    "event" in objectPayload && objectPayload.event && typeof objectPayload.event === "object"
      ? objectPayload.event
      : {}
  const taskEditPayload =
    "task_edit" in objectPayload && objectPayload.task_edit && typeof objectPayload.task_edit === "object"
      ? objectPayload.task_edit
      : {}
  const memoryPayload =
    "memory" in objectPayload && objectPayload.memory && typeof objectPayload.memory === "object"
      ? objectPayload.memory
      : {}

  let primaryIntent = normalizeIntent("primary_intent" in objectPayload ? objectPayload.primary_intent : null)
  if (!primaryIntent || primaryIntent === "unknown") {
    primaryIntent = inferredIntent
  }

  const normalized: ParsedAssistantInput = {
    primary_intent: primaryIntent || fallback.primary_intent,
    secondary_intents:
      "secondary_intents" in objectPayload
        ? normalizeStringArray(objectPayload.secondary_intents)
            .map((value) => normalizeIntent(value))
            .filter((value): value is AssistantIntent => value !== null)
        : [],
    needs_clarification:
      typeof objectPayload === "object" &&
      objectPayload !== null &&
      "needs_clarification" in objectPayload &&
      typeof objectPayload.needs_clarification === "boolean"
        ? objectPayload.needs_clarification
        : fallback.needs_clarification,
    clarification_reason:
      normalizeNullableString(
        "clarification_reason" in objectPayload ? objectPayload.clarification_reason : null,
      ),
    user_facing_summary:
      normalizeNullableString(
        "user_facing_summary" in objectPayload ? objectPayload.user_facing_summary : null,
      ) || buildSummary(primaryIntent || "unknown"),
    task: {
      title: normalizeNullableString("title" in taskPayload ? taskPayload.title : null),
      duration_minutes:
        "duration_minutes" in taskPayload &&
        typeof taskPayload.duration_minutes === "number" &&
        Number.isInteger(taskPayload.duration_minutes) &&
        taskPayload.duration_minutes > 0
          ? taskPayload.duration_minutes
          : null,
      due_at: normalizeNullableString("due_at" in taskPayload ? taskPayload.due_at : null),
      priority: normalizePriority("priority" in taskPayload ? taskPayload.priority : null),
      tags: normalizeStringArray("tags" in taskPayload ? taskPayload.tags : []),
      all_day:
        "all_day" in taskPayload && typeof taskPayload.all_day === "boolean"
          ? taskPayload.all_day
          : false,
      is_immutable:
        "is_immutable" in taskPayload && typeof taskPayload.is_immutable === "boolean"
          ? taskPayload.is_immutable
          : fallback.task.is_immutable,
    },
    event: {
      title: normalizeNullableString("title" in eventPayload ? eventPayload.title : null),
      start_at: normalizeNullableString("start_at" in eventPayload ? eventPayload.start_at : null),
      end_at: normalizeNullableString("end_at" in eventPayload ? eventPayload.end_at : null),
      calendar_id: normalizeNullableString(
        "calendar_id" in eventPayload ? eventPayload.calendar_id : null,
      ),
      all_day:
        "all_day" in eventPayload && typeof eventPayload.all_day === "boolean"
          ? eventPayload.all_day
          : false,
      is_immutable:
        "is_immutable" in eventPayload && typeof eventPayload.is_immutable === "boolean"
          ? eventPayload.is_immutable
          : fallback.event.is_immutable,
    },
    task_edit: {
      target_task_text: normalizeNullableString(
        "target_task_text" in taskEditPayload ? taskEditPayload.target_task_text : null,
      ),
      operation: normalizeTaskEditOperation(
        "operation" in taskEditPayload ? taskEditPayload.operation : null,
      ),
      new_value: normalizeNullableString("new_value" in taskEditPayload ? taskEditPayload.new_value : null),
    },
    memory: {
      operation: normalizeMemoryOperation(
        "operation" in memoryPayload ? memoryPayload.operation : null,
      ),
      content: normalizeNullableString("content" in memoryPayload ? memoryPayload.content : null),
    },
  }

  if (normalized.primary_intent === "create_fixed_event") {
    const hasExplicitImmutability =
      "is_immutable" in eventPayload && typeof eventPayload.is_immutable === "boolean"

    if (!hasExplicitImmutability) {
      normalized.event.is_immutable = inferEventImmutability(rawMessage)
    }

    normalized.event.title = normalized.event.title || deriveTitleFromMessage(rawMessage, "create_fixed_event")

    if (!normalized.event.start_at) {
      normalized.event.start_at = extractTemporalPhrase(rawMessage)
    }

    if (hasAllDayCue(rawMessage)) {
      normalized.event.all_day = true
    }

    if (!normalized.event.all_day && normalized.event.start_at && !hasExplicitTimeCue(rawMessage)) {
      normalized.event.all_day = true
    }

    if (!normalized.event.start_at) {
      normalized.needs_clarification = true
      normalized.clarification_reason =
        normalized.clarification_reason || "The event is clear, but the time is missing."
    } else if (normalized.event.all_day) {
      normalized.needs_clarification = false
      normalized.clarification_reason = null
    }
  }

  if (normalized.primary_intent === "create_task") {
    normalized.task.title = normalized.task.title || deriveTitleFromMessage(rawMessage, "create_task")
    normalized.task.is_immutable = false

    if (!normalized.task.due_at) {
      normalized.task.due_at = extractTemporalPhrase(rawMessage)
    }

    if (normalized.task.tags.length === 0) {
      const tagMatches = rawMessage.match(/\b[A-Z]{2,}\d{2,}\b/g)
      normalized.task.tags = tagMatches ? Array.from(new Set(tagMatches)) : []
    }

    normalized.task.all_day = false

    if (/all-day task/i.test(normalized.user_facing_summary)) {
      normalized.user_facing_summary = normalized.user_facing_summary.replace(
        /all-day task/gi,
        "task due by end of day",
      )
    }
  }

  if (normalized.primary_intent === "remember_preference" && !normalized.memory.operation) {
    normalized.memory.operation = "remember"
    normalized.memory.content = normalized.memory.content || rawMessage.trim()
  }

  if (normalized.primary_intent === "forget_memory" && !normalized.memory.operation) {
    normalized.memory.operation = "forget"
    normalized.memory.content = normalized.memory.content || rawMessage.trim()
  }

  if (
    normalized.primary_intent !== "unknown" &&
    normalized.user_facing_summary === fallback.user_facing_summary
  ) {
    normalized.user_facing_summary = buildSummary(normalized.primary_intent)
  }

  return normalized
}

function validateParsedAssistantInput(payload: unknown, rawMessage: string): z.SafeParseReturnType<unknown, ParsedAssistantInput> {
  return parsedAssistantInputSchema.safeParse(normalizeParsedAssistantInput(payload, rawMessage))
}

// Parsing layer only. Scheduler execution, DB mutation, and Google Calendar behavior are intentionally deferred.
export async function parseAssistantMessage(
  input: AssistantMessageRequest,
): Promise<AssistantParseResult> {
  const client = getClaudeClient()

  if (!client) {
    throw new Error("Missing ANTHROPIC_API_KEY for assistant parser.")
  }

  const response = await client.messages.create({
    model: CLAUDE_PARSER_MODEL,
    max_tokens: 1400,
    temperature: 0,
    system: CLAUDE_PARSER_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildParserUserPrompt(input),
      },
    ],
  })

  const responseText = extractTextContent(response)
  logDevDebug("Raw Claude response text", responseText)

  if (!responseText) {
    return {
      parsed: createFallbackParsedAssistantInput(),
      parserStage: "fallback",
      errorCode: "parse_error",
    }
  }

  const extractedJson = extractJsonObject(responseText)
  logDevDebug("Extracted JSON candidate", extractedJson)

  if (!extractedJson) {
    return {
      parsed: createFallbackParsedAssistantInput(),
      parserStage: "fallback",
      errorCode: "json_extraction_error",
    }
  }

  let parsedCandidate: unknown

  try {
    parsedCandidate = JSON.parse(extractedJson)
  } catch {
    return {
      parsed: createFallbackParsedAssistantInput(),
      parserStage: "fallback",
      errorCode: "json_extraction_error",
    }
  }

  const validatedPayload = validateParsedAssistantInput(parsedCandidate, input.message)

  if (!validatedPayload.success) {
    logDevDebug("Zod validation errors", validatedPayload.error.flatten())

    return {
      parsed: createFallbackParsedAssistantInput(),
      parserStage: "fallback",
      errorCode: "schema_validation_error",
    }
  }

  return {
    parsed: validatedPayload.data,
    parserStage: "validated",
  }
}

// ##### END BACKEND #####
