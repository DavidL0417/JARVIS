import { z } from "zod"

import {
  createOpenAIResponse,
  getOpenAIConfig,
  getOpenAIResponseText,
} from "@/lib/ai/openai"
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

function isExternalWriteCommand(message: string) {
  return /\b(sync|write|push|publish|send|export|mirror|delete|remove|cancel|move|reschedule|invite|email)\b/i.test(message) &&
    /\b(google|calendar|gcal|gmail|notion|external)\b/i.test(message)
}

function externalWriteAction(message: string): SecretaryIntent & { kind: "request_external_write" } {
  const action =
    /\b(sync|push|mirror|publish)\b/i.test(message) &&
    /\b(task|tasks|block|blocks|jarvis)\b/i.test(message) &&
    /\b(google|calendar|gcal)\b/i.test(message)
      ? "google_task_event_sync"
      : "unsupported_external_write"

  return {
    kind: "request_external_write",
    action,
    command: message,
  }
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

async function classifyWithOpenAI(input: {
  message: string
  now: string | null
  timezone: string | null
  history: AssistantConversationEntry[]
}): Promise<ClassifierOutput> {
  const { model } = getOpenAIConfig()
  const payload = await createOpenAIResponse({
    model: process.env.OPENAI_CLASSIFIER_MODEL || model,
    instructions: [
      "Classify a user's secretary/scheduler command into exactly one action.",
      "Use plan_day or replan for day-planning and schedule-shaping requests.",
      "Use request_external_write only when the user wants an external system changed, such as Google Calendar.",
      "Use answer when no write, refresh, memory, task, or planning action is requested.",
      "Return only the structured JSON object.",
    ].join("\n"),
    input: JSON.stringify({
      message: input.message,
      now: input.now,
      timezone: input.timezone,
      recentHistory: input.history.slice(-4),
    }),
    max_output_tokens: 400,
    temperature: 0,
    text: {
      format: {
        type: "json_schema",
        name: "secretary_intent",
        strict: true,
        schema: {
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
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
          },
          required: ["action", "extractedText", "confidence"],
        },
      },
    },
  })
  const text = getOpenAIResponseText(payload)

  if (!text) {
    throw new Error("OpenAI returned no intent classification payload.")
  }

  return classifierSchema.parse(JSON.parse(text))
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
      await classifyWithOpenAI({
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
