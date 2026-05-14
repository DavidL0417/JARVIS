import { createSupabaseAdminClient } from "@/lib/supabase/server"
import type { ScheduleEvent, ScheduleEventRow } from "@/types"
import { mapScheduleEventRowToScheduleEvent, SCHEDULE_EVENT_SELECT } from "@/lib/data/mappers"

const FEEDBACK_ACTION = "calendar.feedback_observed"
const FEEDBACK_SOURCE = "google_calendar_feedback"
const LOOKBACK_DAYS = 14

function minutesBetween(start: string, end: string) {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000))
}

function observationSignature(input: {
  type: string
  eventId: string
  actualStart: string | null
  actualEnd: string | null
}) {
  return [input.type, input.eventId, input.actualStart ?? "", input.actualEnd ?? ""].join("|")
}

function classifyChange(localEvent: ScheduleEvent, externalEvent: ScheduleEvent | null) {
  if (!externalEvent) {
    return {
      type: "deleted",
      summary: `Google Calendar no longer has synced task block "${localEvent.title}".`,
      beforeValue: {
        title: localEvent.title,
        start: localEvent.start,
        end: localEvent.end,
      },
      afterValue: {
        type: "deleted",
        title: localEvent.title,
        start: null,
        end: null,
      },
    }
  }

  const localDuration = minutesBetween(localEvent.start, localEvent.end)
  const externalDuration = minutesBetween(externalEvent.start, externalEvent.end)
  const moved = localEvent.start !== externalEvent.start || localEvent.end !== externalEvent.end
  const durationChanged = localDuration !== externalDuration

  if (!moved && !durationChanged) {
    return null
  }

  return {
    type: durationChanged ? "duration_changed" : "moved",
    summary: durationChanged
      ? `Google Calendar changed the duration of synced task block "${localEvent.title}".`
      : `Google Calendar moved synced task block "${localEvent.title}".`,
    beforeValue: {
      title: localEvent.title,
      start: localEvent.start,
      end: localEvent.end,
      durationMinutes: localDuration,
    },
    afterValue: {
      type: durationChanged ? "duration_changed" : "moved",
      title: externalEvent.title,
      start: externalEvent.start,
      end: externalEvent.end,
      durationMinutes: externalDuration,
    },
  }
}

export const classifyGoogleCalendarTaskChangeForTest = classifyChange

async function hasDuplicateObservation(input: {
  userId: string
  eventId: string
  signature: string
}) {
  const adminClient = createSupabaseAdminClient()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await adminClient
    .from("change_logs")
    .select("after_value")
    .eq("user_id", input.userId)
    .eq("action", FEEDBACK_ACTION)
    .eq("target_table", "schedule_events")
    .eq("target_id", input.eventId)
    .gte("created_at", since)

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).some((row) => {
    const afterValue = row.after_value as Record<string, unknown> | null
    return afterValue?.signature === input.signature
  })
}

async function maybeCreateFeedbackCandidate(userId: string, type: string) {
  const adminClient = createSupabaseAdminClient()
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data: logs, error: logsError } = await adminClient
    .from("change_logs")
    .select("after_value")
    .eq("user_id", userId)
    .eq("action", FEEDBACK_ACTION)
    .eq("source_label", FEEDBACK_SOURCE)
    .gte("created_at", since)

  if (logsError) {
    throw new Error(logsError.message)
  }

  const similarCount = (logs ?? []).filter((row) => {
    const afterValue = row.after_value as Record<string, unknown> | null
    return afterValue?.type === type
  }).length

  if (similarCount < 2) {
    return
  }

  const title =
    type === "deleted"
      ? "Review scheduling pattern: synced task blocks are being deleted"
      : type === "duration_changed"
        ? "Review scheduling pattern: synced task block durations are changing"
        : "Review scheduling pattern: synced task blocks are being moved"

  const { data: existing, error: existingError } = await adminClient
    .from("source_candidates")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "pending")
    .eq("kind", "preference")
    .eq("title", title)
    .limit(1)

  if (existingError) {
    throw new Error(existingError.message)
  }

  if ((existing ?? []).length > 0) {
    return
  }

  const { error: insertError } = await adminClient.from("source_candidates").insert({
    user_id: userId,
    source_snapshot_id: null,
    source_file_id: null,
    kind: "preference",
    title,
    description:
      "JARVIS observed this pattern repeatedly during Google Calendar refresh. Approve only if it should change future scheduling behavior.",
    course: null,
    due_at: null,
    duration_minutes: null,
    priority: "medium",
    confidence: 0.7,
    evidence: `${similarCount} similar Google Calendar observation${similarCount === 1 ? "" : "s"} in the last ${LOOKBACK_DAYS} days.`,
    payload: {
      observationType: type,
      source: FEEDBACK_SOURCE,
      lookbackDays: LOOKBACK_DAYS,
    },
    status: "pending",
  })

  if (insertError) {
    throw new Error(insertError.message)
  }
}

export async function recordGoogleCalendarTaskFeedback(userId: string, externalEvents: ScheduleEvent[]) {
  const adminClient = createSupabaseAdminClient()
  const { data, error } = await adminClient
    .from("schedule_events")
    .select(SCHEDULE_EVENT_SELECT)
    .eq("user_id", userId)
    .eq("source", "task")
    .not("gcal_event_id", "is", null)
    .gte("ends_at", new Date().toISOString())
    .returns<ScheduleEventRow[]>()

  if (error) {
    throw new Error(error.message)
  }

  const localTaskEvents = (data ?? []).map(mapScheduleEventRowToScheduleEvent)
  const externalByGcalId = new Map(
    externalEvents
      .filter((event): event is ScheduleEvent & { gcalEventId: string } => Boolean(event.gcalEventId))
      .map((event) => [event.gcalEventId, event]),
  )

  for (const localEvent of localTaskEvents) {
    if (!localEvent.gcalEventId) {
      continue
    }

    const observation = classifyChange(localEvent, externalByGcalId.get(localEvent.gcalEventId) ?? null)

    if (!observation) {
      continue
    }

    const signature = observationSignature({
      type: observation.type,
      eventId: localEvent.id,
      actualStart: observation.afterValue.start,
      actualEnd: observation.afterValue.end,
    })

    if (await hasDuplicateObservation({ userId, eventId: localEvent.id, signature })) {
      continue
    }

    const { error: insertError } = await adminClient.from("change_logs").insert({
      user_id: userId,
      actor: "system",
      action: FEEDBACK_ACTION,
      target_table: "schedule_events",
      target_id: localEvent.id,
      summary: observation.summary,
      before_value: observation.beforeValue,
      after_value: {
        ...observation.afterValue,
        signature,
        gcalEventId: localEvent.gcalEventId,
      },
      source_label: FEEDBACK_SOURCE,
    })

    if (insertError) {
      throw new Error(insertError.message)
    }

    await maybeCreateFeedbackCandidate(userId, observation.type)
  }
}
