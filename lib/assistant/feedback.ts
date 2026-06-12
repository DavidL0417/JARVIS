import type { SupabaseClient } from "@supabase/supabase-js"

const LOOKBACK_DAYS = 7

/**
 * A compact "what actually happened" summary for the planner: how recently
 * planned task blocks resolved, plus the latest reflection check-ins.
 *
 * Codex principle — "a plan is not a completion": blocks that were scheduled but
 * never confirmed are reported as UNKNOWN, never silently promoted to done.
 * Returns "" when there's nothing worth saying (so callers can skip the section).
 */
export async function buildPlanRealitySummary(
  adminClient: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<string> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const [eventsResult, checkinsResult] = await Promise.all([
    adminClient
      .from("schedule_events")
      .select("status, ends_at")
      .eq("user_id", userId)
      .eq("source", "task")
      .lt("ends_at", now.toISOString())
      .gte("ends_at", since),
    adminClient
      .from("checkins")
      .select("mood, energy, outcome, note, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(3),
  ])

  const events = (eventsResult.data ?? []) as Array<{ status: string | null }>
  const counts = events.reduce<Record<string, number>>((acc, event) => {
    const status = event.status ?? "scheduled"
    acc[status] = (acc[status] ?? 0) + 1
    return acc
  }, {})

  const lines: string[] = []
  const total = events.length

  if (total > 0) {
    const completed = counts.completed ?? 0
    const missed = counts.missed ?? 0
    // Anything still "scheduled" or "unconfirmed" in the past is unconfirmed —
    // there is no evidence it happened.
    const unconfirmed = total - completed - missed

    lines.push(`Over the last ${LOOKBACK_DAYS} days, ${total} planned task block${total === 1 ? "" : "s"} reached their end time:`)
    lines.push(`- ${completed} confirmed done`)
    lines.push(`- ${missed} marked missed`)
    if (unconfirmed > 0) {
      lines.push(`- ${unconfirmed} planned but UNCONFIRMED (no evidence either way — do not assume done)`)
    }
  }

  const checkins = (checkinsResult.data ?? []) as Array<{
    mood: string | null
    energy: string | null
    outcome: string | null
    note: string | null
  }>

  if (checkins.length > 0) {
    lines.push(`Recent check-ins:`)
    for (const checkin of checkins) {
      const parts = [
        checkin.outcome ? `outcome ${checkin.outcome}` : null,
        checkin.energy ? `energy ${checkin.energy}` : null,
        checkin.mood ? `mood ${checkin.mood}` : null,
        checkin.note ? `"${checkin.note.slice(0, 80)}"` : null,
      ].filter(Boolean)
      if (parts.length > 0) {
        lines.push(`- ${parts.join(", ")}`)
      }
    }
  }

  return lines.slice(0, 15).join("\n")
}
