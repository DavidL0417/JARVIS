import type { SupabaseClient } from "@supabase/supabase-js"

import { normalizeMemoryContent } from "@/lib/ai/memory-normalize"
import { loadAssistantRuntimeContext } from "@/lib/assistant/context"
import { generateSecretaryDialogueReply } from "@/lib/assistant/dialogue"
import {
  classifySecretaryIntent,
  normalizeAssistantCommand,
} from "@/lib/assistant/orchestrator"
import { buildDailyPlan } from "@/lib/daily-plan"
import { refreshSourcesForUser } from "@/lib/sources/refresh"
import { setAutomationPaused } from "@/lib/supabase/automation-settings"
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

function hasSchedulingImplication(text: string) {
  return /\b(schedule|reschedule|replan|plan|extend|shorten|spread|space|defer|move|once per|twice per|every|weekly|daily|monthly|hours?|hrs?|minutes?|mins?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|next week|this week|due)\b/i.test(text)
}

function normalizeForMatch(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()
}

function activityMatchesTask(activity: string, title: string) {
  const a = normalizeForMatch(activity)
  const t = normalizeForMatch(title)
  if (!a || !t) return false
  if (t.includes(a) || a.includes(t)) return true
  const aWords = new Set(a.split(" ").filter((word) => word.length >= 4))
  const shared = t.split(" ").filter((word) => word.length >= 4 && aWords.has(word))
  return shared.length >= 2
}

async function handleLogActivity(
  supabase: AdminClient,
  userId: string,
  intent: { activity: string; start: string | null; end: string | null },
): Promise<string> {
  const now = new Date()
  const end = intent.end ? new Date(intent.end) : now
  const start = intent.start ? new Date(intent.start) : new Date(end.getTime() - 60 * 60 * 1000)
  const startIso = start.toISOString()
  const endIso = end.toISOString()

  const { data: taskRows } = await supabase
    .from("tasks")
    .select("id, title")
    .eq("user_id", userId)
    .in("status", ["todo", "scheduled"])

  const matched = (taskRows ?? []).find((row) => activityMatchesTask(intent.activity, row.title as string)) as
    | { id: string; title: string }
    | undefined

  await supabase.from("schedule_events").insert({
    user_id: userId,
    task_id: matched?.id ?? null,
    title: matched?.title ?? intent.activity,
    starts_at: startIso,
    ends_at: endIso,
    source: "task",
    priority: "medium",
    status: "completed",
    is_immutable: false,
    is_checked_in: true,
    all_day: false,
    last_synced_from: "local",
  })

  if (matched) {
    await supabase
      .from("tasks")
      .update({ status: "completed", updated_at: now.toISOString() })
      .eq("id", matched.id)
      .eq("user_id", userId)
    await supabase
      .from("schedule_events")
      .update({ status: "completed", is_checked_in: true, updated_at: now.toISOString() })
      .eq("user_id", userId)
      .eq("task_id", matched.id)
      .eq("source", "task")
      .eq("status", "scheduled")
  }

  // Displacement: other planned blocks overlapping this window are now unconfirmed.
  let displaceQuery = supabase
    .from("schedule_events")
    .update({ status: "unconfirmed", updated_at: now.toISOString() })
    .eq("user_id", userId)
    .eq("source", "task")
    .eq("status", "scheduled")
    .lt("starts_at", endIso)
    .gt("ends_at", startIso)
  if (matched) {
    displaceQuery = displaceQuery.neq("task_id", matched.id)
  }
  const { data: displacedRows } = await displaceQuery.select("title")
  const displaced = (displacedRows ?? []).map((row) => row.title as string)

  await supabase.from("change_logs").insert({
    user_id: userId,
    actor: "user",
    action: "log_activity",
    target_table: "schedule_events",
    summary: `Logged activity: ${intent.activity}${matched ? ` (matched "${matched.title}")` : ""}`,
  })

  let reply = matched ? `Logged "${matched.title}" as done.` : `Logged "${intent.activity}".`
  if (displaced.length > 0) {
    const names = displaced.slice(0, 2).map((title) => `"${title}"`).join(", ")
    reply += ` That overlapped ${displaced.length} planned block${displaced.length === 1 ? "" : "s"} (${names}) — marked unconfirmed. Want me to replan?`
  }
  return reply
}

function formatPauseUntil(iso: string, timezone: string | null) {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) {
    return iso
  }
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || undefined,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date)
  } catch {
    return date.toISOString()
  }
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
  const rawContent = input.content
  const normalizedContent = await normalizeMemoryContent(rawContent)

  const { data: existing, error: existingError } = await supabase
    .from("memory_items")
    .select("id")
    .eq("user_id", input.userId)
    .eq("status", "active")
    .eq("layer", "durable_preferences")
    .eq("content", normalizedContent)
    .limit(1)
    .maybeSingle<{ id: string }>()

  if (existingError) {
    throw new Error(existingError.message)
  }

  if (existing) {
    const dedupeReceipt = makeReceipt("remember", "completed", "Memory already saved; no duplicate added.")
    await insertToolRun(supabase, {
      userId: input.userId,
      threadId: input.threadId,
      messageId: input.assistantMessageId,
      receipt: dedupeReceipt,
      payload: { memoryId: existing.id, content: normalizedContent, deduped: true },
    })
    return dedupeReceipt
  }

  const { data, error } = await supabase
    .from("memory_items")
    .insert({
      user_id: input.userId,
      kind: "preference",
      category: "user_instruction",
      content: normalizedContent,
      importance: "medium",
      layer: "durable_preferences",
      source_label: "master_input",
      payload: {
        promotedFrom: "master_input",
        rawContent,
        normalized: normalizedContent !== rawContent,
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
    payload: { memoryId: data.id, content: normalizedContent, rawContent },
  })
  await insertChangeLog(supabase, {
    userId: input.userId,
    action: "memory.create",
    targetTable: "memory_items",
    targetId: data.id,
    summary: "Saved memory from Master Input.",
    afterValue: { content: normalizedContent, rawContent },
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
  } else if (intent.kind === "pause_automations") {
    await setAutomationPaused({
      userId: input.userId,
      paused: true,
      pausedUntil: intent.until,
      pausedReason: "Paused from secretary chat.",
      adminClient: input.supabase,
    })
    needsRefresh = true
    const untilLabel = intent.until ? formatPauseUntil(intent.until, input.timezone) : null
    reply = untilLabel
      ? `Automations paused until ${untilLabel}. Background refreshes and the daily cron won't run; manual planning still works.`
      : "Automations paused. Background refreshes and the daily cron won't run until you resume; manual planning still works."
    toolCalls.push(makeReceipt("pause_automations", "completed", reply))
  } else if (intent.kind === "resume_automations") {
    await setAutomationPaused({
      userId: input.userId,
      paused: false,
      adminClient: input.supabase,
    })
    needsRefresh = true
    reply = "Automations resumed. Background refreshes and the daily cron will run again."
    toolCalls.push(makeReceipt("resume_automations", "completed", reply))
  } else if (intent.kind === "log_activity") {
    reply = await handleLogActivity(input.supabase, input.userId, {
      activity: intent.activity,
      start: intent.start,
      end: intent.end,
    })
    needsRefresh = true
    toolCalls.push(makeReceipt("log_activity", "completed", reply))
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

  const schedulingChainContent =
    intent.kind === "remember" && hasSchedulingImplication(intent.content)
      ? intent.content
      : null

  if (schedulingChainContent) {
    try {
      const planResult = await buildDailyPlan({
        adminClient: input.supabase,
        userId: input.userId,
        hardEvents: [],
        command: `Applying user preference: ${schedulingChainContent}`,
      })
      const eventCount = planResult.schedule.proposedEvents.length
      const planReceipt = makeReceipt(
        "plan_day",
        "completed",
        `Auto-replanned after remember; ${eventCount} event${eventCount === 1 ? "" : "s"} placed.`,
      )
      await insertToolRun(input.supabase, {
        userId: input.userId,
        threadId,
        messageId: assistantMessageId,
        receipt: planReceipt,
        payload: { command: schedulingChainContent, trigger: "remember_chain" },
      })
      toolCalls.push(planReceipt)
      reply = `${reply} Replanned around it: ${planResult.dailyPlan.summary}`
      needsRefresh = true
      await input.supabase
        .from("assistant_messages")
        .update({ content: reply })
        .eq("id", assistantMessageId)
    } catch (chainError) {
      const chainMessage = chainError instanceof Error ? chainError.message : "Replan failed."
      const planReceipt = makeReceipt("plan_day", "error", "Auto-replan after remember failed.", {
        errorMessage: chainMessage,
      })
      await insertToolRun(input.supabase, {
        userId: input.userId,
        threadId,
        messageId: assistantMessageId,
        receipt: planReceipt,
        payload: { command: schedulingChainContent, trigger: "remember_chain" },
      })
      toolCalls.push(planReceipt)
      reply = `${reply} (Tried to replan but it failed: ${chainMessage})`
      await input.supabase
        .from("assistant_messages")
        .update({ content: reply })
        .eq("id", assistantMessageId)
    }
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
