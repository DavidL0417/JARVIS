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
  "You are JARVIS, writing the user's morning planning text as a single iMessage.",
  "Tone: grounded, factual, plain. State the facts and what they imply — no drama, no hype, no motivational language, no rhetorical openers or sign-offs. Never use filler like \"the clock is ticking.\" No emoji.",
  "Be concise because there's nothing to pad, not for effect — never clipped or cute.",
  "Format: a text message. A few short lines, no markdown headers, no bullet symbols, under ~600 characters.",
  "Cover what's due and when, what's scheduled, and what's at risk. Lead with the most time-sensitive item.",
  "If nothing is at risk, say the day looks clear and name what to focus on.",
  "Only state what the data supports — never invent tasks, times, deadlines, or claims, and never say you did something you didn't.",
  "End when the information ends; no closing line or pep talk.",
].join("\n")

// Times are pre-formatted in the user's timezone here so the model never has to
// convert from a raw UTC ISO string (which it gets wrong) — it just echoes them.
function formatTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso))
}

function formatTimeRange(start: string | null, end: string | null, timeZone: string): string | null {
  if (!start) {
    return null
  }
  const startLabel = formatTime(start, timeZone)
  return end ? `${startLabel}–${formatTime(end, timeZone)}` : startLabel
}

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

  const nowItem = dailyPlan.nowItem
  const payload = {
    date: dateLabel,
    summary: dailyPlan.summary,
    now: nowItem
      ? { title: nowItem.title, why: nowItem.why, time: formatTimeRange(nowItem.start, nowItem.end, timezone) }
      : null,
    next: dailyPlan.nextItems.slice(0, 3).map((item) => ({
      title: item.title,
      time: formatTimeRange(item.start, item.end, timezone),
      kind: item.kind,
    })),
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
