import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { recordAutomationRun } from "@/lib/automation-runs"

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

export interface ReentryRecap {
  gapDays: number
  unconfirmedCount: number
  tasksReturnedToTodo: number
  autoImportedCount: number
  passedDeadlines: string[]
  changed: boolean
}

const AUTO_MISS_AFTER_MS = 7 * 24 * 60 * 60 * 1000

const EMPTY_RECAP: ReentryRecap = {
  gapDays: 0,
  unconfirmedCount: 0,
  tasksReturnedToTodo: 0,
  autoImportedCount: 0,
  passedDeadlines: [],
  changed: false,
}

async function latestTimestamp(
  adminClient: AdminClient,
  table: string,
  userId: string,
  column = "created_at",
): Promise<number | null> {
  const { data } = await adminClient
    .from(table)
    .select(column)
    .eq("user_id", userId)
    .order(column, { ascending: false })
    .limit(1)
    .maybeSingle<Record<string, string>>()

  const value = data?.[column]
  if (!value) {
    return null
  }
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

/**
 * Quietly reconcile a schedule that went stale while the user was away.
 *
 * - Past planned task blocks that were never confirmed become `unconfirmed`
 *   (a plan is not a completion — never auto-complete, never punish as missed).
 * - Stale scheduled tasks return to `todo` so the planner re-places them and
 *   their deadline risk stays visible.
 *
 * Returns a compact recap for the "while you were away" surface, and records a
 * reconciliation automation run ONLY when something actually changed (earned
 * silence). Idempotent: a second call right after changes nothing.
 */
export async function reconcileStaleSchedule(
  adminClient: AdminClient,
  userId: string,
  now: Date = new Date(),
): Promise<ReentryRecap> {
  const nowIso = now.toISOString()

  // Auto-timeout: overdue work the operator never engaged with ages out to
  // `missed` after 7 days. This is the safety net that ends the "Needs you"
  // pile-up — deriveRiskItems suppresses missed tasks, and the Archive surfaces
  // them reversibly. Keyed off the deadline (a null deadline never matches, so
  // undated tasks are never auto-missed). Runs on every load + pre-build, ahead
  // of the stale-block guard so it fires even when no blocks went stale.
  const autoMissCutoffIso = new Date(now.getTime() - AUTO_MISS_AFTER_MS).toISOString()
  const { data: autoMissedRows } = await adminClient
    .from("tasks")
    .update({ status: "missed", scheduled_for: null, updated_at: nowIso })
    .eq("user_id", userId)
    .in("status", ["todo", "scheduled"])
    .lt("deadline", autoMissCutoffIso)
    .select("id")
  const autoMissedTaskIds = (autoMissedRows ?? []).map((row) => row.id as string)
  const autoMissedCount = autoMissedTaskIds.length

  // A missed task keeps no future block — drop its task-source events so the
  // grid and planner don't treat aged-out work as still placed.
  if (autoMissedCount > 0) {
    await adminClient
      .from("schedule_events")
      .delete()
      .eq("user_id", userId)
      .eq("source", "task")
      .in("task_id", autoMissedTaskIds)
  }

  // Cheap guard: is there anything stale at all?
  const { count: staleCount } = await adminClient
    .from("schedule_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("source", "task")
    .eq("status", "scheduled")
    .lt("ends_at", nowIso)

  const { count: staleTaskCount } = await adminClient
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "scheduled")
    .eq("is_immutable", false)
    .lt("scheduled_for", nowIso)

  if ((staleCount ?? 0) === 0 && (staleTaskCount ?? 0) === 0 && autoMissedCount === 0) {
    return EMPTY_RECAP
  }

  // 1) Past planned task blocks -> unconfirmed.
  const { data: unconfirmedRows } = await adminClient
    .from("schedule_events")
    .update({ status: "unconfirmed", updated_at: nowIso })
    .eq("user_id", userId)
    .eq("source", "task")
    .eq("status", "scheduled")
    .lt("ends_at", nowIso)
    .select("id, starts_at")

  // 2) Stale scheduled tasks -> todo (mutable only; planner re-places them).
  const { data: todoRows } = await adminClient
    .from("tasks")
    .update({ status: "todo", scheduled_for: null, updated_at: nowIso })
    .eq("user_id", userId)
    .eq("status", "scheduled")
    .eq("is_immutable", false)
    .lt("scheduled_for", nowIso)
    .select("id")

  const unconfirmedCount = (unconfirmedRows ?? []).length
  const tasksReturnedToTodo = (todoRows ?? []).length

  // Gap = time since the last sign of engagement (a plan build or a check-in).
  const lastPlanMs = await latestTimestamp(adminClient, "daily_plans", userId)
  const lastCheckinMs = await latestTimestamp(adminClient, "checkins", userId)
  const lastEngagementMs = Math.max(lastPlanMs ?? 0, lastCheckinMs ?? 0)
  const gapDays = lastEngagementMs > 0 ? Math.floor((now.getTime() - lastEngagementMs) / (24 * 60 * 60 * 1000)) : 0

  // Items auto-imported while away, and deadlines that passed unscheduled.
  let autoImportedCount = 0
  const passedDeadlines: string[] = []

  if (lastEngagementMs > 0) {
    const sinceIso = new Date(lastEngagementMs).toISOString()
    const { count: importedCount } = await adminClient
      .from("source_candidates")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "approved")
      .gte("updated_at", sinceIso)
    autoImportedCount = importedCount ?? 0

    const { data: deadlineRows } = await adminClient
      .from("tasks")
      .select("title")
      .eq("user_id", userId)
      .neq("status", "completed")
      .gte("deadline", sinceIso)
      .lt("deadline", nowIso)
      .limit(5)
    for (const row of deadlineRows ?? []) {
      if (typeof row.title === "string") {
        passedDeadlines.push(row.title)
      }
    }
  }

  const changed = unconfirmedCount > 0 || tasksReturnedToTodo > 0 || autoMissedCount > 0

  if (changed) {
    const summaryParts = [
      `${unconfirmedCount} block${unconfirmedCount === 1 ? "" : "s"} marked unconfirmed`,
      `${tasksReturnedToTodo} task${tasksReturnedToTodo === 1 ? "" : "s"} returned to the queue`,
    ]
    if (autoMissedCount > 0) {
      summaryParts.push(
        `${autoMissedCount} long-overdue task${autoMissedCount === 1 ? "" : "s"} aged out to missed`,
      )
    }

    await recordAutomationRun({
      userId,
      kind: "reconciliation",
      status: "completed",
      summary: `Reconciled stale schedule: ${summaryParts.join(", ")}.`,
      payload: { unconfirmedCount, tasksReturnedToTodo, autoMissedCount, gapDays },
      adminClient,
    })
  }

  return {
    gapDays,
    unconfirmedCount,
    tasksReturnedToTodo,
    autoImportedCount,
    passedDeadlines,
    changed,
  }
}
