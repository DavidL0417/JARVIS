import {
  RISK_DECISION_SELECT,
  TASK_SELECT,
  mapRiskDecisionRowToRiskDecision,
  mapTaskRowToTask,
} from "@/lib/data/mappers"
import { buildDailyPlan } from "@/lib/daily-plan"
import { generateDigestText } from "@/lib/digest/generate"
import { buildNeedsYou } from "@/lib/needs-you"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import type { RiskDecisionRow, TaskRow } from "@/types"

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

export interface ComposedDigest {
  text: string
  context: Record<string, unknown>
}

const MORNING_SYSTEM_PROMPT = [
  "You are JARVIS, the user's personal chief of staff, sending their MORNING planner as a single iMessage.",
  "Voice: assertive but grounded — direct and energizing, a little punchy, never fluffy, never a corporate status report.",
  "Format: a text message. 3–6 short lines, no markdown headers, no bullet symbols, at most one emoji, under ~600 characters.",
  "Open with the day, name what matters now and what's next, then call out plainly what will crunch them (the risks).",
  "If there are no risks, say the day looks clear and name the single thing to focus on.",
  "Only state what the data supports — never invent tasks, times, deadlines, or claims, and never say you did something you didn't.",
  "End with a short nudge to get moving.",
].join("\n")

/**
 * Compose the morning planner digest. Calls buildDailyPlan — which also lands the
 * server-side reconcile (sync-decision #3) + a source refresh + a fresh plan — then
 * consolidates risks through buildNeedsYou (so snoozed/dismissed/resolved items
 * don't surface) and renders an assertive-but-grounded text via a terse Opus call.
 * Returns the text plus a context blob (task ids referenced) for the reply loop.
 */
export async function buildMorningDigest(
  adminClient: AdminClient,
  userId: string,
  timezone: string,
  now: Date,
): Promise<ComposedDigest> {
  const { dailyPlan } = await buildDailyPlan({ adminClient, userId, hardEvents: [] })

  const [tasksResult, decisionsResult] = await Promise.all([
    adminClient.from("tasks").select(TASK_SELECT).eq("user_id", userId).order("created_at", { ascending: true }),
    adminClient.from("risk_decisions").select(RISK_DECISION_SELECT).eq("user_id", userId),
  ])
  if (tasksResult.error) {
    throw new Error(tasksResult.error.message)
  }
  if (decisionsResult.error) {
    throw new Error(decisionsResult.error.message)
  }

  const tasks = (tasksResult.data || []).map((row) => mapTaskRowToTask(row as TaskRow))
  const decisions = (decisionsResult.data || []).map((row) => mapRiskDecisionRowToRiskDecision(row as RiskDecisionRow))

  const needsYou = buildNeedsYou({
    riskItems: dailyPlan.riskItems,
    tasks,
    decisions,
    now: now.getTime(),
  })
  const topRisks = needsYou.items.slice(0, 3)

  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(now)

  const payload = {
    date: dateLabel,
    summary: dailyPlan.summary,
    now: dailyPlan.nowItem,
    next: dailyPlan.nextItems.slice(0, 3),
    risks: topRisks.map((risk) => ({ title: risk.title, detail: risk.detail, severity: risk.severity })),
  }

  const text = await generateDigestText({ system: MORNING_SYSTEM_PROMPT, payload })

  const taskIds = [dailyPlan.nowItem?.taskId, ...topRisks.map((risk) => risk.taskId)].filter(
    (id): id is string => Boolean(id),
  )

  return {
    text,
    context: {
      kind: "morning_digest",
      planId: dailyPlan.id,
      taskIds: [...new Set(taskIds)],
    },
  }
}
