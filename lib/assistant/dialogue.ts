import Anthropic from "@anthropic-ai/sdk"

import {
  DEFAULT_CLAUDE_PLANNER_MODEL_KEY,
  getClaudePlannerModelOption,
} from "@/lib/ai/claude-models"
import type { AssistantRuntimeContext } from "@/lib/assistant/context"
import type { AssistantConversationEntry, Task } from "@/types"

const DEFAULT_DIALOGUE_MODEL = getClaudePlannerModelOption(DEFAULT_CLAUDE_PLANNER_MODEL_KEY).model

const SECRETARY_DIALOGUE_PROMPT = [
  "You are JARVIS, a trusted personal secretary with access to the user's working context.",
  "Reply directly to the user's latest message like a capable secretary, not a command parser or generic chatbot.",
  "Use the supplied tasks, events, availability, memory, source state, and available scheduling tools when relevant.",
  "You can discuss, plan, capture tasks, remember preferences, and help coordinate the next scheduling move.",
  "If the data is missing or stale, say what you cannot know instead of inventing it.",
  "If asked what model, architecture, or provider you are running on, answer from the runtimeModels payload. Do not claim to be GPT or OpenAI unless the runtimeModels payload says this dialogue turn is OpenAI-backed.",
  "Do not claim to create, update, delete, sync, email, invite, or move anything unless tool results say it happened.",
  "Destructive actions and external calendar writes require explicit approval.",
  "When an imessageThread is present, it is the user's real archived iMessage/SMS conversation with that contact, oldest to newest ('Me' is the user). Answer questions about what was said from it; quote or paraphrase faithfully and never invent messages. If it doesn't cover what they asked, say so.",
  "Sound attentive and operational. Keep the reply spare and useful: one to three short sentences unless the user asks for detail.",
].join("\n")

// One archived iMessage/SMS thread, oldest-first, for answering "what did X say".
export interface ImessageThreadContext {
  contactName: string
  messages: Array<{ at: string | null; from: string; text: string }>
}

interface GenerateSecretaryDialogueReplyInput {
  message: string
  history: AssistantConversationEntry[]
  now: string | null
  timezone: string | null
  runtime: AssistantRuntimeContext
  messageThread?: ImessageThreadContext | null
}

interface SecretaryDialogueReply {
  ok: boolean
  reply: string
  error?: string
  model?: string
}

const ASSISTANT_TASK_SNAPSHOT_LIMIT = 30
const ASSISTANT_UPCOMING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

function taskActionableTime(task: Task): number | null {
  const due = task.deadline ?? task.scheduledFor
  return due ? new Date(due).getTime() : null
}

function taskSourceLabel(task: Task): string {
  if (task.lastSyncedFrom === "apple_reminders") return "Apple Reminders"
  if (task.lastSyncedFrom === "caldav") return "Apple Calendar"
  return "JARVIS"
}

// The assistant used to see only the 8 OLDEST active tasks (slice over a
// created-at-ascending list), so anything captured recently — Apple Reminders,
// fresh quick tasks — was invisible. Now surface (1) tasks due in the next week
// and (2) the most recently captured tasks, which guarantees freshly-added items
// of any source. Each task is tagged with its source so the assistant can answer
// "which Apple Reminders…" precisely.
export function selectAssistantTasks(tasks: Task[], now: number) {
  const active = tasks.filter(
    (task) => task.status !== "completed" && task.status !== "missed",
  )
  // runtime.tasks arrives oldest-first, so a higher index means more recently added.
  const indexed = active.map((task, index) => ({ task, index }))

  const upcoming = indexed
    .filter((entry) => {
      const due = taskActionableTime(entry.task)
      return due !== null && due >= now && due <= now + ASSISTANT_UPCOMING_WINDOW_MS
    })
    .sort((a, b) => (taskActionableTime(a.task) as number) - (taskActionableTime(b.task) as number))
  const recent = [...indexed].sort((a, b) => b.index - a.index)

  const selected: Task[] = []
  const seen = new Set<number>()
  for (const entry of [...upcoming, ...recent]) {
    if (seen.has(entry.index)) continue
    seen.add(entry.index)
    selected.push(entry.task)
    if (selected.length >= ASSISTANT_TASK_SNAPSHOT_LIMIT) break
  }

  return selected.map((task) => ({
    title: task.title,
    status: task.status,
    priority: task.priority,
    deadline: task.deadline,
    scheduledFor: task.scheduledFor,
    durationMinutes: task.durationMinutes,
    immutable: task.isImmutable,
    source: taskSourceLabel(task),
  }))
}

function buildTaskSnapshot(runtime: AssistantRuntimeContext) {
  return selectAssistantTasks(runtime.tasks, Date.now())
}

function buildEventSnapshot(runtime: AssistantRuntimeContext) {
  return runtime.events.slice(0, 8).map((event) => ({
    title: event.title,
    start: event.start,
    end: event.end,
    source: event.source,
    immutable: event.isImmutable,
    calendarId: event.calendarId,
  }))
}

function buildDialoguePayload(input: GenerateSecretaryDialogueReplyInput) {
  return {
    now: input.now,
    timezone: input.timezone,
    latestUserMessage: input.message,
    recentConversation: input.history.slice(-8),
    availability: input.runtime.context.availability,
    availabilityWindows: input.runtime.context.availabilityWindows.slice(0, 8),
    openTasks: buildTaskSnapshot(input.runtime),
    upcomingEvents: buildEventSnapshot(input.runtime),
    memorySummary: input.runtime.context.memorySummary,
    layeredContextMarkdown: input.runtime.layeredContextMarkdown,
    memoryEntries: input.runtime.context.memoryEntries.slice(0, 8),
    sourceSnapshots: input.runtime.context.sourceSnapshots.slice(0, 8),
    pendingCandidateCount: input.runtime.pendingCandidateCount,
    latestDailyPlan: input.runtime.latestDailyPlan,
    recentChangeLogSummaries: input.runtime.recentChangeLogSummaries,
    imessageThread: input.messageThread ?? null,
    runtimeModels: {
      secretaryDialogue: process.env.ANTHROPIC_DIALOGUE_MODEL || process.env.ANTHROPIC_MODEL || DEFAULT_DIALOGUE_MODEL,
      schedulePlanner: "Claude, selected by the planner control when the user builds a plan.",
      notes: [
        "The visible Sonnet/Opus selector controls schedule planning.",
        "This secretary dialogue turn is Claude-backed.",
        "Source extraction and intent classification are Claude-backed as well; JARVIS uses no OpenAI.",
      ],
    },
  }
}

function getClaudeDialogueConfig() {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is missing. Configure Claude before running secretary dialogue model calls.")
  }

  return {
    apiKey,
    model: process.env.ANTHROPIC_DIALOGUE_MODEL || process.env.ANTHROPIC_MODEL || DEFAULT_DIALOGUE_MODEL,
  }
}

function getClaudeMessageText(message: Anthropic.Messages.Message) {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim()
}

export async function generateSecretaryDialogueReply(
  input: GenerateSecretaryDialogueReplyInput,
): Promise<SecretaryDialogueReply> {
  let model: string | undefined
  let apiKey: string

  try {
    const config = getClaudeDialogueConfig()
    apiKey = config.apiKey
    model = config.model
  } catch (error) {
    return {
      ok: false,
      reply: "The secretary model is not configured.",
      error: error instanceof Error ? error.message : "ANTHROPIC_API_KEY is missing.",
    }
  }

  try {
    const payload = buildDialoguePayload(input)
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model,
      system: SECRETARY_DIALOGUE_PROMPT,
      messages: [
        {
          role: "user",
          content: JSON.stringify(payload, null, 2),
        },
      ],
      max_tokens: 420,
      temperature: 0.3,
    })
    const reply = getClaudeMessageText(response)

    if (!reply) {
      return {
        ok: false,
        reply: "The secretary model returned an empty response.",
        error: "Claude returned no text for the secretary dialogue turn.",
        model,
      }
    }

    return {
      ok: true,
      reply,
      model,
    }
  } catch (error) {
    return {
      ok: false,
      reply: "The secretary model call failed.",
      error: error instanceof Error ? error.message : "Claude dialogue request failed.",
      model,
    }
  }
}
