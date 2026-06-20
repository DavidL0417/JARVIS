import { createSupabaseAdminClient } from "@/lib/supabase/server"

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

export type AutomationRunKind =
  | "source_refresh_cron"
  | "pre_plan_refresh"
  | "plan_build"
  | "reconciliation"
  | "deadline_inference"
  | "morning_digest"
  | "evening_digest"

export type AutomationRunStatus = "completed" | "skipped_paused" | "skipped_idle" | "failed"

export interface AutomationRunSummary {
  id: string
  kind: AutomationRunKind
  status: AutomationRunStatus
  summary: string
  startedAt: string
  finishedAt: string | null
}

/**
 * Append one entry to the automation audit log. Best-effort: logging must never
 * break the automation it records, so failures are swallowed (and surfaced to
 * the server console) rather than thrown.
 */
export async function recordAutomationRun(input: {
  userId: string
  kind: AutomationRunKind
  status: AutomationRunStatus
  summary: string
  payload?: Record<string, unknown>
  startedAt?: string
  adminClient?: AdminClient
}): Promise<void> {
  const adminClient = input.adminClient ?? createSupabaseAdminClient()
  const startedAt = input.startedAt ?? new Date().toISOString()

  const { error } = await adminClient.from("automation_runs").insert({
    user_id: input.userId,
    kind: input.kind,
    status: input.status,
    summary: input.summary,
    payload: input.payload ?? {},
    started_at: startedAt,
    finished_at: new Date().toISOString(),
  })

  if (error) {
    console.error(`Failed to record automation run (${input.kind}/${input.status}): ${error.message}`)
  }
}

export async function listRecentAutomationRuns(input: {
  userId: string
  limit?: number
  adminClient?: AdminClient
}): Promise<AutomationRunSummary[]> {
  const adminClient = input.adminClient ?? createSupabaseAdminClient()
  const { data, error } = await adminClient
    .from("automation_runs")
    .select("id, kind, status, summary, started_at, finished_at")
    .eq("user_id", input.userId)
    .order("started_at", { ascending: false })
    .limit(input.limit ?? 20)

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    kind: row.kind as AutomationRunKind,
    status: row.status as AutomationRunStatus,
    summary: row.summary as string,
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string | null) ?? null,
  }))
}
