import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"

import { getClaudePlannerModelOption } from "@/lib/ai/claude-models"
import type { AssistantRuntimeContext } from "@/lib/assistant/context"
import { executeAgentTool, type AgentExecContext } from "@/lib/assistant/agent/executors"
import { getAgentTools, type AgentSurface } from "@/lib/assistant/agent/tools"
import type { AssistantConversationEntry, AssistantToolCallResult, Task } from "@/types"

// The Opus 4.8 agent brain. Replaces the old toolless single-shot dialogue: gives
// Claude real read + write tools and loops on tool_use until it has acted and has
// something to say. This is what turns the secretary from "discusses and asks
// permission" into "resolves from context, does the thing, reports." See
// docs/decisions/secretary-memory.md and project-jarvis-agent-empowerment-todo.
const DEFAULT_AGENT_MODEL = getClaudePlannerModelOption("opus").model // claude-opus-4-8

const MAX_ITERATIONS = 8
const MAX_TOKENS = 1024
const TASK_CONTEXT_LIMIT = 30

function agentModel() {
  // Opus 4.8 powers the agent brain by default (sharper multi-step tool use).
  // Override only via ANTHROPIC_AGENT_MODEL — deliberately NOT inheriting
  // ANTHROPIC_DIALOGUE_MODEL, which would silently downgrade the loop to Sonnet.
  return process.env.ANTHROPIC_AGENT_MODEL || DEFAULT_AGENT_MODEL
}

const SYSTEM_PROMPT_BASE = [
  "You are JARVIS, David's empowered executive secretary. You ACT — you do not merely describe what could be done.",
  "",
  "Operating principles:",
  "- RESOLVE before asking. Use the context payload and the read tools (find_tasks, get_schedule, search_gmail, read_imessage) to work out what the user means. Never ask 'which task?' or 'what do you want me to change?' when a tool or the context can tell you.",
  "- ACT, then report. For internal changes — editing a task, scheduling, completing, planning the day, saving a durable preference — use the tools to DO it now, then confirm in one or two sentences what changed. Do NOT ask permission for these internal edits; the user expects you to just do them.",
  "- External/outbound actions are gated and only QUEUE an approval — never write immediately; tell the user it is waiting on their confirm. To write a one-off event onto their Google Calendar use create_calendar_event (target an existing calendar by name; you CANNOT create a new calendar — if the named one doesn't exist, say so). To mirror their scheduled JARVIS task blocks onto Google Calendar use sync_tasks_to_google. You CANNOT send email or texts, write to Apple/CalDAV calendars, or delete/move existing external events — say so plainly if asked, and offer to capture it as a JARVIS task/block instead.",
  "- Honesty: only claim something happened if a tool returned success. If a tool failed, say what failed.",
  "- Immutable tasks are real appointments — don't reschedule them; if asked, explain why and offer an alternative.",
  "- Be concise and operational: 1–3 sentences unless asked for detail. No filler, no 'I'd be happy to.'",
  "- Compute concrete times from the `now` and `timezone` in the context payload.",
].join("\n")

// Resolved at runtime so the assistant can answer "what model are you on?" with its
// actual model, not a stale hardcoded one.
function identityLine(model: string) {
  return `You are running on Anthropic's model \`${model}\` (Anthropic's Claude). If asked what model/provider you are, state that model id specifically; never claim OpenAI or GPT.`
}

const READ_ONLY_NOTE = [
  "",
  "NOTE: this surface is READ-ONLY. You can look things up and answer, but you have no write tools here — to change a task or the schedule the user must use the JARVIS app (or tick the confirm checkbox). If they ask for a change, do the lookup and tell them exactly what you would change and where to confirm it.",
  "",
  "BREVITY: this is the Raycast note — your reply is collapsed onto a SINGLE line, so keep it scannable, never a wall of text. Answer in 1–2 short sentences and lead with the answer itself. Drop the preamble, the caveats, and the bulleted lists of clarifying questions; if you genuinely need one thing to proceed, ask just that one thing in a single short sentence.",
].join("\n")

export interface RunAssistantAgentLoopInput {
  supabase: SupabaseClient
  userId: string
  message: string
  now: string | null
  timezone: string | null
  history: AssistantConversationEntry[]
  runtime: AssistantRuntimeContext
  surface: AgentSurface
}

export interface AgentLoopReceipt {
  result: AssistantToolCallResult
  payload?: Record<string, unknown>
}

export interface AgentLoopResult {
  ok: boolean
  reply: string
  error?: string
  model: string
  needsRefresh: boolean
  clarification: string | null
  receipts: AgentLoopReceipt[]
}

function getAgentConfig() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is missing. Configure Claude before running the assistant agent loop.")
  }
  return { apiKey, model: agentModel() }
}

// Active tasks WITH ids so the model can act directly (find_tasks is for anything
// not in this snapshot). Most-recent first; capped to keep the prompt lean.
function buildTaskContext(tasks: Task[]) {
  return tasks
    .filter((task) => task.status !== "completed" && task.status !== "missed")
    .slice(-TASK_CONTEXT_LIMIT)
    .reverse()
    .map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      deadline: task.deadline,
      scheduledFor: task.scheduledFor,
      durationMinutes: task.durationMinutes,
      isImmutable: task.isImmutable,
    }))
}

function buildContextPayload(input: RunAssistantAgentLoopInput) {
  return {
    now: input.now,
    timezone: input.timezone,
    surface: input.surface,
    latestUserMessage: input.message,
    recentConversation: input.history.slice(-8),
    availability: input.runtime.context.availability,
    openTasks: buildTaskContext(input.runtime.tasks),
    upcomingEvents: input.runtime.events.slice(0, 10).map((event) => ({
      title: event.title,
      start: event.start,
      end: event.end,
      source: event.source,
      immutable: event.isImmutable,
    })),
    memorySummary: input.runtime.context.memorySummary,
    sourceSnapshots: input.runtime.context.sourceSnapshots.slice(0, 6),
    latestDailyPlan: input.runtime.latestDailyPlan?.summary ?? null,
    pendingCandidateCount: input.runtime.pendingCandidateCount,
  }
}

function extractText(message: Anthropic.Messages.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim()
}

export async function runAssistantAgentLoop(input: RunAssistantAgentLoopInput): Promise<AgentLoopResult> {
  let model: string
  let apiKey: string
  try {
    const config = getAgentConfig()
    apiKey = config.apiKey
    model = config.model
  } catch (error) {
    return {
      ok: false,
      reply: "The assistant model is not configured.",
      error: error instanceof Error ? error.message : "ANTHROPIC_API_KEY is missing.",
      model: agentModel(),
      needsRefresh: false,
      clarification: null,
      receipts: [],
    }
  }

  const ctx: AgentExecContext = {
    supabase: input.supabase,
    userId: input.userId,
    now: input.now,
    timezone: input.timezone,
    surface: input.surface,
    runtime: input.runtime,
    command: input.message,
  }
  const baseSystem = input.surface === "note" ? `${SYSTEM_PROMPT_BASE}${READ_ONLY_NOTE}` : SYSTEM_PROMPT_BASE
  const system = `${baseSystem}\n\n${identityLine(model)}`
  const tools = getAgentTools(input.surface)
  const receipts: AgentLoopReceipt[] = []
  let needsRefresh = false

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: JSON.stringify(buildContextPayload(input), null, 2) },
  ]

  try {
    const client = new Anthropic({ apiKey })
    let finalText = ""
    let stoppedWithText = false

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const response = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system,
        messages,
        tools,
      })
      messages.push({ role: "assistant", content: response.content })

      if (response.stop_reason !== "tool_use") {
        finalText = extractText(response)
        stoppedWithText = true
        break
      }

      const toolUses = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      )
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const toolUse of toolUses) {
        const outcome = await executeAgentTool(
          toolUse.name,
          (toolUse.input ?? {}) as Record<string, unknown>,
          ctx,
        )
        receipts.push({ result: outcome.receipt, payload: outcome.payload })
        if (outcome.didWrite) {
          needsRefresh = true
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: JSON.stringify(outcome.resultForModel),
          is_error: outcome.receipt.status === "error",
        })
      }
      messages.push({ role: "user", content: toolResults })
    }

    // Iteration cap hit mid-tool-use: ask for a closing summary with tools off so
    // the model wraps up instead of looping forever.
    if (!stoppedWithText) {
      const wrapUp = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        system,
        messages,
      })
      finalText = extractText(wrapUp)
    }

    return {
      ok: true,
      reply: finalText || "Done.",
      model,
      needsRefresh,
      clarification: null,
      receipts,
    }
  } catch (error) {
    // Surface loop failures server-side; the response only carries a short message,
    // and a silent throw here is hard to diagnose (e.g. an unsupported request param).
    console.error("[assistant-agent-loop] failed:", error)
    return {
      ok: false,
      reply: "The assistant hit an error before it could finish that.",
      error: error instanceof Error ? error.message : "Assistant agent loop failed.",
      model,
      needsRefresh,
      clarification: null,
      receipts,
    }
  }
}
