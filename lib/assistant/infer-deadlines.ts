import { z } from "zod"

import { runClaudeStructuredExtraction } from "@/lib/ai/claude-extraction"
import { unexpiredOrFilter } from "@/lib/assistant/memory-write"
import { mapTaskRowToTask, MEMORY_ITEM_SELECT, TASK_SELECT } from "@/lib/data/mappers"
import type { createSupabaseAdminClient } from "@/lib/supabase/server"
import { listScheduleEventRowsInWindow } from "@/lib/supabase/schedule-events"
import type { MemoryItemRow, ScheduleEventRow, TaskRow } from "@/types"

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

const MAX_TASKS = 50
const MAX_EVENTS = 40
const MAX_MEMORY = 30
const INFER_OUTPUT_TOKENS = 2000
const ANCHOR_LOOKAHEAD_DAYS = 240

const INFER_DEADLINES_PROMPT = [
  "You infer IMPLICIT deadlines for a student's UNDATED tasks — only to catch the forgotten-deadline case, never to nag.",
  "Propose a by-when for a task ONLY when a CONCRETE dated anchor in the provided context makes a deadline logically follow: a dated trip, a dated event or appointment, or an explicit dependency between the task and something dated.",
  "Good examples: 'service the car' before a dated multi-week road trip; 'buy a gift' before a dated birthday; 'renew passport' before dated international travel; 'submit form' before a dated appointment that needs it.",
  "If a task has no such concrete anchor, OMIT it entirely — stay silent. Never invent urgency, never use generic 'soon', never guess. A wrong suggestion is worse than none.",
  "The by-when must be a real date derived from the anchor (e.g., a few days before a trip departs), as an ISO 8601 date.",
  "Always explain the anchor in `reason` in one short sentence that names the dated thing and its date (this is shown to the user verbatim).",
  "Only use task ids that appear in the UNDATED TASKS list. Return at most one suggestion per task.",
].join("\n")

const inferenceSchema = z.object({
  suggestions: z
    .array(
      z.object({
        taskId: z.string(),
        byWhen: z.string(),
        reason: z.string().min(1),
      }),
    )
    .default([]),
})

function inferenceJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      suggestions: {
        type: "array",
        description: "One entry per undated task that has a concrete dated anchor. Omit tasks with no anchor.",
        items: {
          type: "object",
          properties: {
            taskId: { type: "string", description: "An id from the UNDATED TASKS list." },
            byWhen: { type: "string", description: "ISO 8601 date the task should be done by, derived from the anchor." },
            reason: {
              type: "string",
              description: "One sentence naming the dated anchor and its date, shown to the user.",
            },
          },
          required: ["taskId", "byWhen", "reason"],
        },
      },
    },
    required: ["suggestions"],
  }
}

function formatEventDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
}

/**
 * Infer suggested deadlines for a user's undated tasks and cache them on the task
 * (inferred_deadline + reason). Explicit deadlines are authoritative, so only
 * tasks with a null deadline are considered, and tasks the operator chose to
 * "Keep undated" (dismissed) are skipped. A re-run retracts a stale suggestion
 * that no longer has an anchor. Never writes `deadline` — that needs approval.
 *
 * Self-contained (queries its own context) so it can run from the daily cron or
 * inside a plan build. Throws are the caller's to swallow; inference must never
 * break planning.
 */
export async function inferDeadlinesForUser(
  adminClient: AdminClient,
  userId: string,
): Promise<{ suggested: number; retracted: number; considered: number }> {
  const { data: taskRows, error: taskError } = await adminClient
    .from("tasks")
    .select(TASK_SELECT)
    .eq("user_id", userId)
    .in("status", ["todo", "scheduled"])
    .is("deadline", null)
    .eq("inferred_deadline_dismissed", false)
    .order("created_at", { ascending: false })
    .limit(MAX_TASKS)

  if (taskError) {
    throw new Error(taskError.message)
  }

  const tasks = (taskRows ?? []).map((row) => mapTaskRowToTask(row as TaskRow))

  if (tasks.length === 0) {
    return { suggested: 0, retracted: 0, considered: 0 }
  }

  const taskIds = new Set(tasks.map((task) => task.id))

  const [eventsResult, memoryResult] = await Promise.all([
    listScheduleEventRowsInWindow(adminClient, userId, { lookbackDays: 0, lookaheadDays: ANCHOR_LOOKAHEAD_DAYS }),
    adminClient
      .from("memory_items")
      .select(MEMORY_ITEM_SELECT)
      .eq("user_id", userId)
      .eq("status", "active")
      .or(unexpiredOrFilter())
      .order("created_at", { ascending: false })
      .limit(MAX_MEMORY),
  ])

  const events = (eventsResult.data ?? []) as ScheduleEventRow[]
  const memory = (memoryResult.data ?? []) as MemoryItemRow[]

  const taskLines = tasks
    .map((task) => `- ${task.id} — ${task.title}${task.description ? ` — ${task.description}` : ""}`)
    .join("\n")
  const eventLines = events
    .slice(0, MAX_EVENTS)
    .map((event) => `- ${formatEventDate(event.starts_at)} — ${event.title}`)
    .join("\n")
  const memoryLines = memory
    .map((item) => `- ${item.content}`)
    .join("\n")

  const content = [
    `TODAY: ${new Date().toISOString()}`,
    "",
    "UNDATED TASKS (id — title — description):",
    taskLines,
    "",
    "UPCOMING DATED EVENTS (possible anchors):",
    eventLines || "- (none)",
    "",
    "DURABLE CONTEXT / MEMORY (possible anchors — trips, commitments, dependencies):",
    memoryLines || "- (none)",
  ].join("\n")

  const extraction = await runClaudeStructuredExtraction({
    system: INFER_DEADLINES_PROMPT,
    content,
    toolName: "return_inferred_deadlines",
    toolDescription: "Return suggested by-when deadlines for undated tasks that have a concrete dated anchor.",
    inputSchema: inferenceJsonSchema(),
    maxTokens: INFER_OUTPUT_TOKENS,
  })

  const parsed = inferenceSchema.safeParse(extraction.data)
  if (!parsed.success) {
    throw new Error("DEADLINE_INFERENCE_FAILED: Claude returned an unparseable inference payload.")
  }

  const now = new Date().toISOString()
  const suggestedTaskIds = new Set<string>()
  let suggested = 0

  for (const suggestion of parsed.data.suggestions) {
    if (!taskIds.has(suggestion.taskId)) {
      continue
    }

    const byWhen = new Date(suggestion.byWhen)
    if (Number.isNaN(byWhen.getTime())) {
      continue
    }

    const { error: updateError } = await adminClient
      .from("tasks")
      .update({
        inferred_deadline: byWhen.toISOString(),
        inferred_deadline_reason: suggestion.reason,
        updated_at: now,
      })
      .eq("id", suggestion.taskId)
      .eq("user_id", userId)

    if (updateError) {
      throw new Error(updateError.message)
    }

    suggestedTaskIds.add(suggestion.taskId)
    suggested += 1
  }

  // Retract stale suggestions: a previously-suggested task that this run no
  // longer anchors should not keep showing an outdated nudge.
  const staleTaskIds = tasks
    .filter((task) => task.inferredDeadline && !suggestedTaskIds.has(task.id))
    .map((task) => task.id)
  let retracted = 0

  if (staleTaskIds.length > 0) {
    const { error: clearError } = await adminClient
      .from("tasks")
      .update({ inferred_deadline: null, inferred_deadline_reason: null, updated_at: now })
      .eq("user_id", userId)
      .in("id", staleTaskIds)

    if (clearError) {
      throw new Error(clearError.message)
    }

    retracted = staleTaskIds.length
  }

  return { suggested, retracted, considered: tasks.length }
}
