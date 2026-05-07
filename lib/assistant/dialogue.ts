import {
  createOpenAIResponse,
  getOpenAIConfig,
  getOpenAIResponseText,
} from "@/lib/ai/openai"
import type { AssistantRuntimeContext } from "@/lib/assistant/context"
import type { AssistantConversationEntry } from "@/types"

const SECRETARY_DIALOGUE_PROMPT = [
  "You are JARVIS, a trusted personal secretary with access to the user's working context.",
  "Reply directly to the user's latest message like a capable secretary, not a command parser or generic chatbot.",
  "Use the supplied tasks, events, availability, memory, source state, and available scheduling tools when relevant.",
  "You can discuss, plan, capture tasks, remember preferences, and help coordinate the next scheduling move.",
  "If the data is missing or stale, say what you cannot know instead of inventing it.",
  "Do not claim to create, update, delete, sync, email, invite, or move anything unless tool results say it happened.",
  "Destructive actions and external calendar writes require explicit approval.",
  "Sound attentive and operational. Keep the reply spare and useful: one to three short sentences unless the user asks for detail.",
].join("\n")

interface GenerateSecretaryDialogueReplyInput {
  message: string
  history: AssistantConversationEntry[]
  now: string | null
  timezone: string | null
  runtime: AssistantRuntimeContext
}

interface SecretaryDialogueReply {
  ok: boolean
  reply: string
  error?: string
  model?: string
}

function buildTaskSnapshot(runtime: AssistantRuntimeContext) {
  return runtime.tasks
    .filter((task) => task.status !== "completed" && task.status !== "missed")
    .slice(0, 8)
    .map((task) => ({
      title: task.title,
      status: task.status,
      priority: task.priority,
      deadline: task.deadline,
      scheduledFor: task.scheduledFor,
      durationMinutes: task.durationMinutes,
      immutable: task.isImmutable,
    }))
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
    memoryEntries: input.runtime.context.memoryEntries.slice(0, 8),
    sourceSnapshots: input.runtime.context.sourceSnapshots.slice(0, 8),
  }
}

export async function generateSecretaryDialogueReply(
  input: GenerateSecretaryDialogueReplyInput,
): Promise<SecretaryDialogueReply> {
  let model: string | undefined

  try {
    model = process.env.OPENAI_DIALOGUE_MODEL || getOpenAIConfig().model
  } catch (error) {
    return {
      ok: false,
      reply: "The secretary model is not configured.",
      error: error instanceof Error ? error.message : "OPENAI_API_KEY is missing.",
    }
  }

  try {
    const payload = buildDialoguePayload(input)
    const response = await createOpenAIResponse({
      model,
      instructions: SECRETARY_DIALOGUE_PROMPT,
      input: JSON.stringify(payload, null, 2),
      max_output_tokens: 420,
      temperature: 0.3,
    })
    const reply = getOpenAIResponseText(response)

    if (!reply) {
      return {
        ok: false,
        reply: "The secretary model returned an empty response.",
        error: "OpenAI returned no text for the secretary dialogue turn.",
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
      error: error instanceof Error ? error.message : "OpenAI dialogue request failed.",
      model,
    }
  }
}
