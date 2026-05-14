import type { SupabaseClient } from "@supabase/supabase-js"

import { loadAssistantRuntimeContext } from "@/lib/assistant/context"
import { generateSecretaryDialogueReply } from "@/lib/assistant/dialogue"
import {
  classifySecretaryIntent,
  normalizeAssistantCommand,
} from "@/lib/assistant/orchestrator"
import { buildDailyPlan } from "@/lib/daily-plan"
import { refreshSourcesForUser } from "@/lib/sources/refresh"
import type { requireAuthenticatedUser } from "@/lib/supabase/auth"
import { TASKS_CALENDAR_ID } from "@/lib/task-calendar-constants"
import { assistantMessageResponseSchema } from "@/schemas/assistant"
import type {
  AssistantConversationEntry,
  AssistantMessageResponse,
  AssistantToolCallResult,
  Priority,
} from "@/types"

interface RunSecretaryTurnInput {
  supabase: AdminClient
  userId: string
  message: string
  now: string | null
  timezone: string | null
  history: AssistantConversationEntry[]
}

type AdminClient = Awaited<ReturnType<typeof requireAuthenticatedUser>>["adminClient"]

function normalizeText(value: string) {
  return normalizeAssistantCommand(value)
}

function makeReceipt(
  tool: string,
  status: AssistantToolCallResult["status"],
  summary: string,
  options?: Pick<AssistantToolCallResult, "requiresApproval" | "errorMessage">,
): AssistantToolCallResult {
  return {
    id: crypto.randomUUID(),
    tool,
    status,
    summary,
    ...options,
  }
}

async function createThread(supabase: SupabaseClient, userId: string, title: string) {
  const { data, error } = await supabase
    .from("assistant_threads")
    .insert({
      user_id: userId,
      title: title.slice(0, 80),
    })
    .select("id")
    .single<{ id: string }>()

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create assistant thread.")
  }

  return data.id
}

async function insertMessage(
  supabase: SupabaseClient,
  input: {
    userId: string
    threadId: string
    role: "user" | "assistant"
    content: string
  },
) {
  const { data, error } = await supabase
    .from("assistant_messages")
    .insert({
      user_id: input.userId,
      thread_id: input.threadId,
      role: input.role,
      content: input.content,
    })
    .select("id")
    .single<{ id: string }>()

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to record assistant message.")
  }

  return data.id
}

async function insertToolRun(
  supabase: SupabaseClient,
  input: {
    userId: string
    threadId: string
    messageId: string | null
    receipt: AssistantToolCallResult
    payload?: Record<string, unknown>
    requiresApproval?: boolean
  },
) {
  const { error } = await supabase.from("assistant_tool_runs").insert({
    id: input.receipt.id,
    user_id: input.userId,
    thread_id: input.threadId,
    message_id: input.messageId,
    tool_name: input.receipt.tool,
    status: input.receipt.status,
    summary: input.receipt.summary,
    payload: input.payload ?? {},
    requires_approval: input.requiresApproval ?? input.receipt.status === "pending_approval",
    error_message: input.receipt.errorMessage ?? null,
  })

  if (error) {
    throw new Error(error.message)
  }
}

async function insertChangeLog(
  supabase: SupabaseClient,
  input: {
    userId: string
    action: string
    targetTable: string
    targetId: string
    summary: string
    afterValue?: Record<string, unknown>
  },
) {
  const { error } = await supabase.from("change_logs").insert({
    user_id: input.userId,
    actor: "assistant",
    action: input.action,
    target_table: input.targetTable,
    target_id: input.targetId,
    summary: input.summary,
    before_value: null,
    after_value: input.afterValue ?? null,
    source_label: "master_input",
  })

  if (error) {
    throw new Error(error.message)
  }
}

async function handleRemember(
  supabase: SupabaseClient,
  input: {
    userId: string
    threadId: string
    assistantMessageId: string | null
    content: string
  },
) {
  const { data, error } = await supabase
    .from("memory_items")
    .insert({
      user_id: input.userId,
      kind: "preference",
      category: "user_instruction",
      content: input.content,
      importance: "medium",
      layer: "durable_preferences",
      source_label: "master_input",
      payload: {
        promotedFrom: "master_input",
      },
      status: "active",
      confidence: 0.9,
    })
    .select("id")
    .single<{ id: string }>()

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to save memory.")
  }

  const receipt = makeReceipt("remember", "completed", "Saved one durable memory item.")
  await insertToolRun(supabase, {
    userId: input.userId,
    threadId: input.threadId,
    messageId: input.assistantMessageId,
    receipt,
    payload: { memoryId: data.id, content: input.content },
  })
  await insertChangeLog(supabase, {
    userId: input.userId,
    action: "memory.create",
    targetTable: "memory_items",
    targetId: data.id,
    summary: "Saved memory from Master Input.",
    afterValue: { content: input.content },
  })

  return receipt
}

async function handleCreateTask(
  supabase: SupabaseClient,
  input: {
    userId: string
    threadId: string
    assistantMessageId: string | null
    title: string
    priority: Priority
  },
) {
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: input.userId,
      title: input.title,
      description: null,
      deadline: null,
      duration_minutes: null,
      priority: input.priority,
      status: "todo",
      scheduled_for: null,
      is_immutable: false,
      all_day: false,
      calendar_id: TASKS_CALENDAR_ID,
      tags: [],
    })
    .select("id, title, priority")
    .single<{ id: string; title: string; priority: Priority }>()

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create task.")
  }

  const receipt = makeReceipt("create_task", "completed", `Created "${data.title}".`)
  await insertToolRun(supabase, {
    userId: input.userId,
    threadId: input.threadId,
    messageId: input.assistantMessageId,
    receipt,
    payload: { taskId: data.id, title: data.title, priority: data.priority },
  })
  await insertChangeLog(supabase, {
    userId: input.userId,
    action: "task.create",
    targetTable: "tasks",
    targetId: data.id,
    summary: `Created task "${data.title}" from Master Input.`,
    afterValue: { title: data.title, priority: data.priority },
  })

  return receipt
}

export async function runSecretaryTurn(input: RunSecretaryTurnInput): Promise<AssistantMessageResponse> {
  const cleanMessage = normalizeText(input.message)
  const runtimeBefore = await loadAssistantRuntimeContext(input.supabase, input.userId)
  const intent = await classifySecretaryIntent({
    message: cleanMessage,
    now: input.now,
    timezone: input.timezone,
    history: input.history,
  })
  const threadId = await createThread(input.supabase, input.userId, cleanMessage || "Master Input")
  await insertMessage(input.supabase, {
    userId: input.userId,
    threadId,
    role: "user",
    content: cleanMessage,
  })

  const toolCalls: AssistantToolCallResult[] = []
  let reply: string
  let ok = true
  let error: string | undefined
  let model: string | undefined
  let needsRefresh = false
  let clarification: string | null = null

  if (intent.kind === "classification_error") {
    ok = false
    error = intent.error
    reply = "I could not safely classify that secretary request."
    toolCalls.push(makeReceipt("classify_intent", "error", "Intent classification failed.", { errorMessage: intent.error }))
  } else if (intent.kind === "request_external_write") {
    if (intent.action === "google_task_event_sync") {
      const receipt = makeReceipt(
        "google_task_event_sync",
        "pending_approval",
        "Prepared a Google Calendar task-block sync approval.",
        { requiresApproval: true },
      )
      toolCalls.push(receipt)
      reply = "I can sync the scheduled JARVIS task blocks to Google Calendar after approval."
      clarification = "Approve this only if you want JARVIS to create or update task events on Google Calendar."
    } else {
      ok = false
      error = "That external write is not supported yet. Google Calendar task-block sync is the only executable external write currently enabled."
      reply = "I cannot safely execute that external write yet."
      toolCalls.push(makeReceipt("external_write", "error", "Unsupported external write.", { errorMessage: error }))
    }
  } else if (intent.kind === "refresh_sources") {
    const refresh = await refreshSourcesForUser({
      userId: input.userId,
      mode: "cron",
    })
    const failed = refresh.items.filter((item) => item.status === "failed")
    ok = failed.length === 0
    needsRefresh = true
    reply = failed.length
      ? `Source refresh hit ${failed.length} failure${failed.length === 1 ? "" : "s"}. ${failed.map((item) => item.error || item.summary).join(" ")}`
      : "Sources refreshed."
    toolCalls.push(
      makeReceipt("refresh_sources", failed.length ? "error" : "completed", refresh.items.map((item) => `${item.source}: ${item.status}`).join("; "), {
        errorMessage: failed.length ? failed.map((item) => item.error || item.summary).join("\n") : null,
      }),
    )
    error = failed.length ? failed.map((item) => item.error || item.summary).join("\n") : undefined
  } else if (intent.kind === "plan_day") {
    try {
      const planResult = await buildDailyPlan({
        adminClient: input.supabase,
        userId: input.userId,
        hardEvents: [],
        command: intent.command,
      })
      needsRefresh = true
      reply = planResult.dailyPlan.summary
      toolCalls.push(
        makeReceipt(
          "plan_day",
          "completed",
          `Built a daily plan with ${planResult.schedule.proposedEvents.length} event${planResult.schedule.proposedEvents.length === 1 ? "" : "s"}.`,
        ),
      )
    } catch (planError) {
      ok = false
      error = planError instanceof Error ? planError.message : "Daily planning failed."
      reply = "I could not build the plan because the planner or pre-plan source refresh failed."
      toolCalls.push(makeReceipt("plan_day", "error", "Daily planning failed.", { errorMessage: error }))
    }
  } else if (intent.kind === "review_feedback") {
    reply = "Feedback observations and candidate memories are waiting in the review queue; I will not promote them automatically."
    toolCalls.push(makeReceipt("review_feedback", "completed", "Checked feedback review policy; promotion still requires review."))
  } else if (intent.kind === "remember") {
    reply = "Remembered."
    needsRefresh = true
  } else if (intent.kind === "create_task") {
    reply = `Added "${intent.title}".`
    needsRefresh = true
  } else {
    const dialogue = await generateSecretaryDialogueReply({
      message: cleanMessage,
      now: input.now,
      timezone: input.timezone,
      history: input.history,
      runtime: runtimeBefore,
    })
    reply = dialogue.reply
    ok = dialogue.ok
    error = dialogue.error
    model = dialogue.model
  }

  const assistantMessageId = await insertMessage(input.supabase, {
    userId: input.userId,
    threadId,
    role: "assistant",
    content: reply,
  })

  if (toolCalls.length > 0) {
    for (const toolCall of toolCalls) {
      await insertToolRun(input.supabase, {
        userId: input.userId,
        threadId,
        messageId: assistantMessageId,
        receipt: toolCall,
        payload:
          intent.kind === "request_external_write" &&
          intent.action === "google_task_event_sync" &&
          toolCall.tool === "google_task_event_sync"
            ? {
                action: intent.action,
                command: intent.command,
              }
            : intent.kind === "plan_day" && toolCall.tool === "plan_day"
              ? {
                  command: intent.command,
                }
              : intent.kind === "refresh_sources" && toolCall.tool === "refresh_sources"
                ? {
                    command: intent.command,
                  }
                : undefined,
        requiresApproval: toolCall.requiresApproval,
      })
    }
  }

  if (intent.kind === "remember") {
    toolCalls.push(
      await handleRemember(input.supabase, {
        userId: input.userId,
        threadId,
        assistantMessageId,
        content: intent.content,
      }),
    )
  } else if (intent.kind === "create_task") {
    toolCalls.push(
      await handleCreateTask(input.supabase, {
        userId: input.userId,
        threadId,
        assistantMessageId,
        title: intent.title,
        priority: intent.priority,
      }),
    )
  }

  const runtimeAfter = needsRefresh
    ? await loadAssistantRuntimeContext(input.supabase, input.userId)
    : runtimeBefore

  return assistantMessageResponseSchema.parse({
    ok,
    reply,
    toolCalls,
    needsRefresh,
    clarification,
    context: runtimeAfter.context,
    error,
    debug: model ? { model } : undefined,
  })
}
