import type { SupabaseClient } from "@supabase/supabase-js"

import { SCHEDULE_EVENT_SELECT } from "@/lib/data/mappers"
import type { ScheduleEventRow } from "@/types"

// Supabase/PostgREST silently caps any single query at 1000 rows. An unbounded
// `select * from schedule_events` therefore truncates once a user's mirrored
// calendars exceed that — ordered by starts_at, everything in the FUTURE silently
// vanishes (the grid goes empty, the planner can't see upcoming events). This
// loader is the only sanctioned way to read schedule events in bulk: it bounds the
// query to a relevance window and paginates, so it can never hit the cap.
const PAGE_SIZE = 1000
const DAY_IN_MS = 24 * 60 * 60 * 1000

export interface ScheduleEventWindow {
  lookbackDays: number
  lookaheadDays: number
}

export interface ScheduleEventRowsResult {
  data: ScheduleEventRow[] | null
  error: { message: string } | null
}

export async function listScheduleEventRowsInWindow(
  client: SupabaseClient,
  userId: string,
  window: ScheduleEventWindow,
): Promise<ScheduleEventRowsResult> {
  const now = Date.now()
  const windowStart = new Date(now - window.lookbackDays * DAY_IN_MS).toISOString()
  const windowEnd = new Date(now + window.lookaheadDays * DAY_IN_MS).toISOString()
  const rows: ScheduleEventRow[] = []

  for (let page = 0; ; page += 1) {
    const from = page * PAGE_SIZE
    const { data, error } = await client
      .from("schedule_events")
      .select(SCHEDULE_EVENT_SELECT)
      .eq("user_id", userId)
      // Overlap semantics: keep events still in flight at windowStart.
      .gte("ends_at", windowStart)
      .lte("starts_at", windowEnd)
      .order("starts_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      return { data: null, error: { message: error.message } }
    }

    const pageRows = (data ?? []) as unknown as ScheduleEventRow[]
    rows.push(...pageRows)

    if (pageRows.length < PAGE_SIZE) {
      break
    }
  }

  return { data: rows, error: null }
}

// Mirrored events accumulate forever otherwise: both sync windows look back 90 days,
// but nothing deletes what falls out the back. Google/Apple remain the source of
// truth for history, so events that ended over a year ago can go. Tasks, check-ins,
// and locally-created events are never touched.
const MIRRORED_EVENT_RETENTION_DAYS = 365

export async function pruneExpiredMirroredEvents(client: SupabaseClient, userId: string) {
  const cutoff = new Date(Date.now() - MIRRORED_EVENT_RETENTION_DAYS * DAY_IN_MS).toISOString()
  const { error } = await client
    .from("schedule_events")
    .delete()
    .eq("user_id", userId)
    .in("last_synced_from", ["gcal", "caldav"])
    .lt("ends_at", cutoff)

  if (error) {
    throw new Error(error.message)
  }
}
