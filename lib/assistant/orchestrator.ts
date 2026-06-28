import { z } from "zod"

import { runClaudeStructuredExtraction } from "@/lib/ai/claude-extraction"
import { resolveNaturalDateTime } from "@/lib/assistant/date-utils"
import { DEFAULT_TIMEZONE } from "@/lib/time/zoned"
import type { AssistantConversationEntry, Priority } from "@/types"

const classifierSchema = z.object({
  action: z.enum([
    "answer",
    "plan_day",
    "replan",
    "create_task",
    "remember",
    "refresh_sources",
    "request_external_write",
    "review_feedback",
  ]),
  extractedText: z.string().trim().nullable(),
  confidence: z.number().min(0).max(1),
})

type ClassifierOutput = z.infer<typeof classifierSchema>

export type SecretaryIntent =
  | { kind: "answer"; model?: string }
  | { kind: "classification_error"; error: string }
  | { kind: "create_task"; title: string; priority: Priority }
  | { kind: "remember"; content: string }
  | { kind: "plan_day"; command: string }
  | { kind: "refresh_sources"; command: string }
  | { kind: "request_external_write"; action: "google_task_event_sync" | "unsupported_external_write"; command: string }
  | { kind: "review_feedback"; command: string }
  | { kind: "pause_automations"; until: string | null; command: string }
  | { kind: "resume_automations"; command: string }
  | { kind: "log_activity"; activity: string; start: string | null; end: string | null; command: string }
  | { kind: "read_messages"; contactQuery: string; command: string }

export function normalizeAssistantCommand(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

export function parseTaskTitle(message: string) {
  const normalized = normalizeAssistantCommand(message)
  const taskPatterns = [
    /^(?:add|create)\s+(?:a\s+)?(?:task|todo|to-do)\s+(?:to\s+)?(?<title>.+)$/i,
    /^(?:todo|task):\s*(?<title>.+)$/i,
    /^remind me to\s+(?<title>.+)$/i,
  ]

  for (const pattern of taskPatterns) {
    const match = normalized.match(pattern)
    const title = match?.groups?.title?.trim()

    if (title) {
      return title
    }
  }

  return null
}

export function parsePriority(message: string): Priority {
  const normalized = message.toLowerCase()

  if (/\b(high|urgent|important|critical)\b/.test(normalized)) {
    return "high"
  }

  if (/\b(low|someday|backlog)\b/.test(normalized)) {
    return "low"
  }

  return "medium"
}

export function parseMemoryContent(message: string) {
  const normalized = normalizeAssistantCommand(message)
  const memoryPatterns = [
    /^remember(?: that)?\s+(?<content>.+)$/i,
    /^note(?: that)?\s+(?<content>.+)$/i,
  ]

  for (const pattern of memoryPatterns) {
    const match = normalized.match(pattern)
    const content = match?.groups?.content?.trim()

    if (content) {
      return content
    }
  }

  return null
}

// Strip a trailing topic/punctuation from a captured contact name so
// "Alan about the deck?" -> "Alan".
function cleanContactName(raw: string): string {
  return raw
    .replace(/\?+$/g, "")
    .replace(/\b(?:about|regarding|concerning|re)\b.*$/i, "")
    .replace(/[.,;:!]+$/g, "")
    .replace(/^@/, "")
    .trim()
}

// Pronouns/determiners that are never a contact name. Stops open-ended
// questions like "did anyone send me anything" or "what did the email say"
// from being mis-read as a request for one person's thread. Each alternative
// is anchored with \b so real names that merely start with these letters
// ("Ian", "Theo", "Noah", "Anya") are still captured.
const NON_CONTACT_SUBJECT =
  "(?!(?:you|i|we|they|he|she|it|anyone|anybody|anything|someone|somebody|something|everyone|everybody|everything|nobody|none|no\\s?one|the|this|that|these|those)\\b)"

// Detect a request to read the archived iMessage/SMS thread with a contact, e.g.
// "what did Alan say about the trip", "read my messages with Dani", "texts from Mom".
// Returns the contact name to resolve against the allowlist, or null.
export function parseReadMessages(message: string): string | null {
  const normalized = normalizeAssistantCommand(message)

  // If the ask is plainly about email (or another non-iMessage channel) and
  // gives no iMessage/text signal, it isn't a read-thread request — let it fall
  // through to the agent loop, which can search Gmail. Guards the "did <X> send"
  // pattern against "check my email — did anyone send me anything about X".
  const mentionsEmail = /\b(?:e-?mails?|inbox(?:es)?|gmail)\b/i.test(normalized)
  const mentionsTextChannel = /\b(?:imessages?|texts?|texted|texting|sms|dms?|message[sd]?|messaging)\b/i.test(normalized)
  if (mentionsEmail && !mentionsTextChannel) {
    return null
  }

  const patterns = [
    // verb-led: read/show/pull up/access/list out/give me/get me ... messages|texts|... with|from X
    // (run-up class excludes only . and ! so a mid-sentence "?" — e.g. "my imessages? if so,
    // list out messages from Alan" — doesn't sever the verb from the noun; name stops at .?!)
    /\b(?:read|show(?:\s+me)?|pull up|see|check|look at|find|search|access|list(?:\s+out)?|give me|get me|grab|fetch)\b[^.!]*\b(?:messages?|texts?|imessages?|conversations?|threads?|chats?|dms?)\b\s+(?:with|from)\s+(?<name>[^.?!]+)/i,
    new RegExp(
      `^(?:what did|what'd|what has|what's)\\s+(?<name>${NON_CONTACT_SUBJECT}.+?)\\s+(?:say|said|text|texted|message|messaged|tell|told|send|sent|been saying|been texting)\\b`,
      "i",
    ),
    /^(?:messages?|texts?|imessages?|conversations?|threads?|chats?)\s+(?:with|from)\s+(?<name>.+)$/i,
    new RegExp(`\\bdid\\s+(?<name>${NON_CONTACT_SUBJECT}[a-z].+?)\\s+(?:say|text|message|mention|send)\\b`, "i"),
    // "any|new ... messages|texts|word from X"
    /\b(?:any|anything|new)\b[^.!]*\b(?:messages?|texts?|imessages?|word)\b\s+(?:with|from)\s+(?<name>[^.?!]+)/i,
  ]
  for (const pattern of patterns) {
    const name = normalized.match(pattern)?.groups?.name
    if (name) {
      const cleaned = cleanContactName(name)
      if (cleaned) {
        return cleaned
      }
    }
  }
  return null
}

function parsePauseCommand(message: string): { action: "pause" | "resume"; untilText: string | null } | null {
  const normalized = message.toLowerCase()
  const targetsAutomations =
    /\b(automation|automations|update|updates|refresh|refreshes|syncing|background|cron|brief|sentinel)\b/.test(normalized)

  if (!targetsAutomations) {
    return null
  }

  if (/\b(resume|unpause|un-pause|restart|re-?enable|turn (?:back )?on|wake up)\b/.test(normalized)) {
    return { action: "resume", untilText: null }
  }

  if (/\b(pause|stop|halt|hold off|suspend|disable|turn off|quiet|mute|snooze)\b/.test(normalized)) {
    const untilMatch = normalized.match(/\b(?:until|till|til|through|thru)\s+(.+)$/)
    return { action: "pause", untilText: untilMatch ? untilMatch[1].trim() : null }
  }

  return null
}

function parseActivityLog(
  message: string,
  timezone: string,
  now: string | null,
): { activity: string; start: string | null; end: string | null } | null {
  const match = message
    .trim()
    .match(/^(?:i\s+)?(?:just\s+)?(?:did|finished|completed|wrapped up|knocked out|worked on|got through)\s+(.+)$/i)
  if (!match) {
    return null
  }

  let rest = match[1].trim()
  let start: string | null = null
  let end: string | null = null

  const window =
    rest.match(/\bfrom\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:to|until|till|-|–)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i) ||
    rest.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i)

  if (window) {
    // Borrow the meridiem from the end time if the start omitted it ("2-4pm").
    const endMeridiem = window[2].match(/(am|pm)/i)?.[0] ?? ""
    const startText = /(am|pm)/i.test(window[1]) ? window[1] : `${window[1]}${endMeridiem}`
    start = resolveNaturalDateTime(`today ${startText.trim()}`, timezone, { referenceNow: now })
    end = resolveNaturalDateTime(`today ${window[2].trim()}`, timezone, { referenceNow: now })
    rest = rest.replace(window[0], "").replace(/\bfrom\s*$/i, "").trim()
  }

  const activity = rest.replace(/[.,;:]+$/, "").replace(/\b(today|just now|earlier)\b/gi, "").trim()
  if (!activity) {
    return null
  }

  return { activity, start, end }
}

// Verbs that imply an external write regardless of target (Google/Gmail/Notion/…).
// NOTE: "email" is deliberately NOT here — it is overwhelmingly a NOUN ("search my
// Gmail for my most recent email"), and matching it hijacked read/search questions
// into the unsupported-external-write path. A genuine "send an email …" still trips
// this via "send".
const BROAD_WRITE_VERBS = /\b(sync|write|push|publish|send|export|mirror|delete|remove|cancel|move|reschedule|invite)\b/i
const BROAD_WRITE_TARGETS = /\b(google|calendar|gcal|gmail|notion|external|icloud)\b/i
// Calendar-create verbs only count as an external write when a calendar target is
// named — otherwise "create a page in notion" / "add a contact" would be wrongly
// captured and rejected. Confines the broadening to the capability we built
// (Google + Apple/iCloud event creation, both handled by the agent loop).
const CALENDAR_WRITE_VERBS = /\b(add|create|put|book|set up|new)\b/i
// Any calendar target (Google or Apple). The agent loop picks the matching tool
// (create_calendar_event vs create_apple_calendar_event) from the user's wording.
// Bare "apple" is intentionally NOT a target ("add apple juice to my list" is not a
// calendar write) — "apple calendar" is still caught by the "calendar" alternative.
const CALENDAR_TARGET = /\b(google|gcal|calendar|icloud)\b/i
// Google-specific target — task-block sync only writes to Google Calendar.
const GOOGLE_CALENDAR_TARGET = /\b(google|gcal|calendar)\b/i
// Destructive / move operations on external calendars are NOT supported — they must
// reach the unsupported branch even when phrased with an "add"-ish verb ("put off" =
// postpone, "push back" = reschedule).
const DESTRUCTIVE_EXTERNAL = /\b(delete|remove|cancel|move|reschedule|postpone|push back|put off|put back)\b/i

function isExternalWriteCommand(message: string) {
  return (
    (BROAD_WRITE_VERBS.test(message) && BROAD_WRITE_TARGETS.test(message)) ||
    (CALENDAR_WRITE_VERBS.test(message) && CALENDAR_TARGET.test(message))
  )
}

function externalWriteAction(message: string): SecretaryIntent {
  const targetsCalendar = CALENDAR_TARGET.test(message)
  const isDestructive = DESTRUCTIVE_EXTERNAL.test(message)

  const isTaskBlockSync =
    /\b(sync|push|mirror|publish)\b/i.test(message) &&
    /\b(task|tasks|block|blocks|jarvis)\b/i.test(message) &&
    GOOGLE_CALENDAR_TARGET.test(message)

  if (isTaskBlockSync) {
    return { kind: "request_external_write", action: "google_task_event_sync", command: message }
  }

  // Writing a one-off event onto the user's Google OR Apple/iCloud calendar is now a
  // first-class capability, handled by the agent loop's create_calendar_event /
  // create_apple_calendar_event tools (approval-gated). Route it to the loop instead
  // of rejecting it. Destructive/move requests are excluded — those remain
  // unsupported and fall through below.
  const isCalendarEventWrite =
    !isDestructive &&
    /\b(add|create|put|book|write|set up|new|schedule)\b/i.test(message) &&
    targetsCalendar

  if (isCalendarEventWrite) {
    return { kind: "answer" }
  }

  return { kind: "request_external_write", action: "unsupported_external_write", command: message }
}

function isPlanningCommand(message: string) {
  return /\b(plan|replan|schedule|reschedule|what should i do|build today|make today|make tomorrow|lighter|protect|free up|rest of day)\b/i.test(
    message,
  )
}

function isRefreshCommand(message: string) {
  return /\b(refresh|sync|rescan|reload|pull)\b/i.test(message) &&
    /\b(source|sources|gmail|notion|calendar|google)\b/i.test(message)
}

function isFeedbackReviewCommand(message: string) {
  return /\b(review|promote|approve|dismiss|feedback|candidate|memory)\b/i.test(message) &&
    /\b(memory|candidate|feedback|observation|preference)\b/i.test(message)
}

function shouldUseClassifier(message: string) {
  return /\b(can you|please|i need|help me|figure out|handle|make|set up|do this)\b/i.test(message) &&
    /\b(today|tomorrow|schedule|calendar|task|remember|source|gmail|notion|google|feedback|memory)\b/i.test(message)
}

// Reuses the shared Claude structured-tool helper (also used by source
// extraction) to classify an ambiguous secretary command into exactly one
// action. Callers wrap this in try/catch and degrade to a plain answer.
async function classifyWithClaude(input: {
  message: string
  now: string | null
  timezone: string | null
  history: AssistantConversationEntry[]
}): Promise<ClassifierOutput> {
  const { data } = await runClaudeStructuredExtraction({
    system: [
      "Classify a user's secretary/scheduler command into exactly one action.",
      "Use plan_day or replan for day-planning and schedule-shaping requests.",
      "Use request_external_write only when the user wants an external system changed, such as Google Calendar.",
      "Use answer when no write, refresh, memory, task, or planning action is requested.",
      "Return the classification via the return_secretary_intent tool.",
    ].join("\n"),
    content: [
      {
        type: "text",
        text: JSON.stringify({
          message: input.message,
          now: input.now,
          timezone: input.timezone,
          recentHistory: input.history.slice(-4),
        }),
      },
    ],
    toolName: "return_secretary_intent",
    toolDescription: "Classify the secretary command into exactly one action.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: [
            "answer",
            "plan_day",
            "replan",
            "create_task",
            "remember",
            "refresh_sources",
            "request_external_write",
            "review_feedback",
          ],
        },
        extractedText: {
          type: ["string", "null"],
          description: "The task title, memory text, or planning command to pass forward.",
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["action", "extractedText", "confidence"],
    },
    maxTokens: 400,
  })

  return classifierSchema.parse(data)
}

function intentFromClassifier(output: ClassifierOutput, command: string): SecretaryIntent {
  const extractedText = output.extractedText?.trim() || command

  if (output.confidence < 0.5) {
    return { kind: "answer" }
  }

  if (output.action === "create_task") {
    return {
      kind: "create_task",
      title: extractedText,
      priority: parsePriority(command),
    }
  }

  if (output.action === "remember") {
    return {
      kind: "remember",
      content: extractedText,
    }
  }

  if (output.action === "plan_day" || output.action === "replan") {
    return {
      kind: "plan_day",
      command,
    }
  }

  if (output.action === "refresh_sources") {
    return {
      kind: "refresh_sources",
      command,
    }
  }

  if (output.action === "request_external_write") {
    return externalWriteAction(command)
  }

  if (output.action === "review_feedback") {
    return {
      kind: "review_feedback",
      command,
    }
  }

  return { kind: "answer" }
}

export async function classifySecretaryIntent(input: {
  message: string
  now: string | null
  timezone: string | null
  history: AssistantConversationEntry[]
}): Promise<SecretaryIntent> {
  const command = normalizeAssistantCommand(input.message)
  const memoryContent = parseMemoryContent(command)

  if (memoryContent) {
    return {
      kind: "remember",
      content: memoryContent,
    }
  }

  const taskTitle = parseTaskTitle(command)

  if (taskTitle) {
    return {
      kind: "create_task",
      title: taskTitle,
      priority: parsePriority(command),
    }
  }

  const activityLog = parseActivityLog(command, input.timezone || DEFAULT_TIMEZONE, input.now)

  if (activityLog) {
    return {
      kind: "log_activity",
      activity: activityLog.activity,
      start: activityLog.start,
      end: activityLog.end,
      command,
    }
  }

  const messageContact = parseReadMessages(command)

  if (messageContact) {
    return { kind: "read_messages", contactQuery: messageContact, command }
  }

  const pauseCommand = parsePauseCommand(command)

  if (pauseCommand) {
    if (pauseCommand.action === "resume") {
      return { kind: "resume_automations", command }
    }

    const until = pauseCommand.untilText
      ? resolveNaturalDateTime(pauseCommand.untilText, input.timezone || DEFAULT_TIMEZONE, {
          defaultTime: "09:00",
        })
      : null

    return { kind: "pause_automations", until, command }
  }

  if (isExternalWriteCommand(command)) {
    return externalWriteAction(command)
  }

  if (isRefreshCommand(command)) {
    return {
      kind: "refresh_sources",
      command,
    }
  }

  if (isFeedbackReviewCommand(command)) {
    return {
      kind: "review_feedback",
      command,
    }
  }

  if (isPlanningCommand(command)) {
    return {
      kind: "plan_day",
      command,
    }
  }

  if (!shouldUseClassifier(command)) {
    return { kind: "answer" }
  }

  try {
    return intentFromClassifier(
      await classifyWithClaude({
        message: command,
        now: input.now,
        timezone: input.timezone,
        history: input.history,
      }),
      command,
    )
  } catch (error) {
    return {
      kind: "classification_error",
      error: error instanceof Error ? error.message : "Failed to classify secretary request.",
    }
  }
}
