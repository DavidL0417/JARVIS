import {
  CanvasApiError,
  fetchCanvasPaginated,
  type CanvasPlannerItem,
} from "@/lib/canvas"
import {
  mapSourceCandidateRowToCandidate,
  mapTaskRowToTask,
  SOURCE_CANDIDATE_SELECT,
  TASK_SELECT,
} from "@/lib/data/mappers"
import { insertSourceSnapshot } from "@/lib/sources/persistence"
import {
  getStoredCanvasIntegration,
  markCanvasIntegrationStatus,
} from "@/lib/supabase/canvas-integration"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { TASKS_CALENDAR_ID } from "@/lib/task-calendar-constants"
import type { SourceIntakeResponse } from "@/schemas/sources"
import type {
  Priority,
  SourceCandidate,
  SourceCandidateKind,
  SourceCandidateRow,
  Task,
  TaskRow,
} from "@/types"

const CANVAS_IMPORT_PAST_DAYS = 14
const CANVAS_IMPORT_FUTURE_DAYS = 90
const SUPPORTED_CANVAS_PLANNABLE_TYPES = new Set([
  "assignment",
  "quiz",
  "discussion_topic",
  "calendar_event",
])

interface CanvasTaskCandidate {
  key: string
  kind: SourceCandidateKind
  title: string
  description: string | null
  course: string | null
  dueAt: string | null
  durationMinutes: number | null
  priority: Priority
  confidence: number
  evidence: string | null
  payload: {
    canvas: {
      baseUrl: string
      courseId: string | null
      courseName: string | null
      htmlUrl: string | null
      plannableId: string
      plannableType: string
      plannableKey: string
      plannerOverrideId: string | null
      markedComplete: boolean
      submitted: boolean
    }
  }
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10)
}

function normalizeNullableText(value: string | null | undefined) {
  const trimmed = value?.replace(/\s+/g, " ").trim()
  return trimmed ? trimmed : null
}

function normalizeDateTime(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function stringId(value: number | string | null | undefined) {
  if (value === null || value === undefined) {
    return null
  }

  const text = String(value).trim()
  return text ? text : null
}

function canvasPayload(candidate: SourceCandidate | SourceCandidateRow) {
  const payload = "payload" in candidate ? candidate.payload : {}
  const canvas = payload && typeof payload === "object" ? (payload as { canvas?: unknown }).canvas : null
  return canvas && typeof canvas === "object" ? canvas as Record<string, unknown> : null
}

function candidateKey(candidate: SourceCandidate | SourceCandidateRow) {
  const canvas = canvasPayload(candidate)
  return typeof canvas?.plannableKey === "string" ? canvas.plannableKey : null
}

function itemIsComplete(item: CanvasPlannerItem) {
  return Boolean(item.planner_override?.marked_complete || item.submissions?.submitted)
}

function itemToCandidate(item: CanvasPlannerItem, baseUrl: string): CanvasTaskCandidate | null {
  const plannableType = normalizeNullableText(item.plannable_type)?.toLowerCase() ?? null
  const plannableId = stringId(item.plannable_id ?? item.plannable?.id)

  if (!plannableType || !plannableId || !SUPPORTED_CANVAS_PLANNABLE_TYPES.has(plannableType)) {
    return null
  }

  if (itemIsComplete(item)) {
    return null
  }

  const title = normalizeNullableText(item.plannable?.title ?? item.plannable?.name)

  if (!title) {
    return null
  }

  const dueAt = normalizeDateTime(item.plannable?.due_at ?? item.plannable?.todo_date ?? item.plannable_date ?? item.date)
  const courseName = normalizeNullableText(item.context_name)
  const htmlUrl = normalizeNullableText(item.html_url ?? item.plannable?.html_url)
  const courseId = stringId(item.course_id)
  const plannerOverrideId = stringId(item.planner_override?.id)
  const plannableKey = `${plannableType}:${plannableId}`
  const dueSoon = dueAt ? new Date(dueAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000 : false

  return {
    key: plannableKey,
    kind: dueAt ? "deadline" : "task",
    title,
    description: [
      courseName ? `Course: ${courseName}` : null,
      htmlUrl ? `Canvas: ${htmlUrl}` : null,
    ].filter((part): part is string => Boolean(part)).join("\n") || null,
    course: courseName,
    dueAt,
    durationMinutes: null,
    priority: dueSoon ? "high" : "medium",
    confidence: dueAt ? 0.98 : 0.85,
    evidence: htmlUrl ?? `${baseUrl}/api/v1/planner/items`,
    payload: {
      canvas: {
        baseUrl,
        courseId,
        courseName,
        htmlUrl,
        plannableId,
        plannableType,
        plannableKey,
        plannerOverrideId,
        markedComplete: Boolean(item.planner_override?.marked_complete),
        submitted: Boolean(item.submissions?.submitted),
      },
    },
  }
}

// Canvas plannable types ("discussion_topic", "quiz") → human category labels
// ("Discussion Topic", "Quiz") so they read like the Notion Category chips.
function humanizePlannableType(plannableType: string | null | undefined): string | null {
  if (!plannableType) {
    return null
  }
  const label = plannableType
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ")
    .trim()
  return label || null
}

function taskFieldsForCandidate(candidate: CanvasTaskCandidate, userId: string, sourceSnapshotId: string, sourceCandidateId: string) {
  return {
    user_id: userId,
    title: candidate.title,
    description: candidate.description,
    deadline: candidate.kind === "deadline" || candidate.kind === "task" ? candidate.dueAt : null,
    duration_minutes: candidate.durationMinutes,
    priority: candidate.priority,
    status: "todo" as const,
    scheduled_for: null,
    is_immutable: false,
    all_day: false,
    calendar_id: TASKS_CALENDAR_ID,
    // course + plannable type now live in their own columns; tags keeps only the
    // "canvas" source marker (taskSourceLabel's fallback, hidden from display).
    tags: ["canvas"],
    course: candidate.course ?? null,
    category: humanizePlannableType(candidate.payload.canvas.plannableType),
    source_snapshot_id: sourceSnapshotId,
    source_candidate_id: sourceCandidateId,
    plan_id: null,
    last_synced_from: "canvas" as const,
  }
}

async function fetchExistingCanvasCandidates(userId: string) {
  const adminClient = createSupabaseAdminClient()
  // Include `dismissed` rows. A still-live Canvas assignment whose dedup key was
  // retired to `dismissed` (auto-approve-only cleanup, or a prior prune) must be
  // RECLAIMED via the update branch of upsertCanvasTaskCandidate — re-inserting it
  // would collide with the cross-status unique key and throw, failing the refresh.
  const { data, error } = await adminClient
    .from("source_candidates")
    .select(SOURCE_CANDIDATE_SELECT)
    .eq("user_id", userId)
    .returns<SourceCandidateRow[]>()

  if (error) {
    throw new Error(error.message)
  }

  return new Map(
    (data || [])
      .map((candidate) => [candidateKey(candidate), candidate] as const)
      .filter((entry): entry is [string, SourceCandidateRow] => Boolean(entry[0])),
  )
}

async function upsertCanvasTaskCandidate(input: {
  userId: string
  sourceSnapshotId: string
  candidate: CanvasTaskCandidate
  existing?: SourceCandidateRow | null
}) {
  const adminClient = createSupabaseAdminClient()
  const now = new Date().toISOString()
  let candidateRow = input.existing ?? null

  if (candidateRow) {
    const { data, error } = await adminClient
      .from("source_candidates")
      .update({
        source_snapshot_id: input.sourceSnapshotId,
        kind: input.candidate.kind,
        title: input.candidate.title,
        description: input.candidate.description,
        course: input.candidate.course,
        due_at: input.candidate.dueAt,
        duration_minutes: input.candidate.durationMinutes,
        priority: input.candidate.priority,
        confidence: input.candidate.confidence,
        evidence: input.candidate.evidence,
        payload: input.candidate.payload,
        status: "approved",
        updated_at: now,
      })
      .eq("id", candidateRow.id)
      .eq("user_id", input.userId)
      .select(SOURCE_CANDIDATE_SELECT)
      .single<SourceCandidateRow>()

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to update Canvas source candidate.")
    }

    candidateRow = data
  } else {
    const { data, error } = await adminClient
      .from("source_candidates")
      .insert({
        user_id: input.userId,
        source_snapshot_id: input.sourceSnapshotId,
        source_file_id: null,
        kind: input.candidate.kind,
        title: input.candidate.title,
        description: input.candidate.description,
        course: input.candidate.course,
        due_at: input.candidate.dueAt,
        duration_minutes: input.candidate.durationMinutes,
        priority: input.candidate.priority,
        confidence: input.candidate.confidence,
        evidence: input.candidate.evidence,
        payload: input.candidate.payload,
        status: "approved",
      })
      .select(SOURCE_CANDIDATE_SELECT)
      .single<SourceCandidateRow>()

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to insert Canvas source candidate.")
    }

    candidateRow = data
  }

  const taskFields = taskFieldsForCandidate(input.candidate, input.userId, input.sourceSnapshotId, candidateRow.id)
  let task: Task

  if (candidateRow.approved_task_id) {
    const {
      user_id: _userId,
      status: _status,
      scheduled_for: _scheduledFor,
      ...taskUpdateFields
    } = taskFields
    const { data, error } = await adminClient
      .from("tasks")
      .update({
        ...taskUpdateFields,
        updated_at: now,
      })
      .eq("id", candidateRow.approved_task_id)
      .eq("user_id", input.userId)
      .select(TASK_SELECT)
      .maybeSingle<TaskRow>()

    if (error) {
      throw new Error(error.message)
    }

    if (data) {
      task = mapTaskRowToTask(data)
    } else {
      candidateRow.approved_task_id = null
    }
  }

  if (!candidateRow.approved_task_id) {
    const { data, error } = await adminClient
      .from("tasks")
      .insert(taskFields)
      .select(TASK_SELECT)
      .single<TaskRow>()

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to create Canvas task.")
    }

    task = mapTaskRowToTask(data)

    const { data: linkedCandidate, error: linkError } = await adminClient
      .from("source_candidates")
      .update({
        status: "approved",
        approved_task_id: task.id,
        updated_at: now,
      })
      .eq("id", candidateRow.id)
      .eq("user_id", input.userId)
      .select(SOURCE_CANDIDATE_SELECT)
      .single<SourceCandidateRow>()

    if (linkError || !linkedCandidate) {
      throw new Error(linkError?.message ?? "Failed to link Canvas candidate to task.")
    }

    candidateRow = linkedCandidate
  }

  return {
    task: task!,
    candidate: mapSourceCandidateRowToCandidate(candidateRow),
  }
}

export function canvasPlannerItemsToCandidates(items: CanvasPlannerItem[], baseUrl: string) {
  const seen = new Set<string>()
  const candidates: CanvasTaskCandidate[] = []

  for (const item of items) {
    const candidate = itemToCandidate(item, baseUrl)

    if (!candidate || seen.has(candidate.key)) {
      continue
    }

    seen.add(candidate.key)
    candidates.push(candidate)
  }

  return candidates
}

function buildSummary(input: {
  rawCount: number
  candidateCount: number
  createdOrUpdated: number
  baseName: string | null
}) {
  const label = input.baseName ?? "Canvas"

  if (input.rawCount === 0) {
    return `${label} planner refresh completed; no planner items were returned.`
  }

  return `${label} planner refresh found ${input.candidateCount} actionable Canvas item${input.candidateCount === 1 ? "" : "s"} and synced ${input.createdOrUpdated} task${input.createdOrUpdated === 1 ? "" : "s"}.`
}

export async function refreshCanvasForUser(userId: string): Promise<SourceIntakeResponse> {
  const adminClient = createSupabaseAdminClient()
  const integration = await getStoredCanvasIntegration(userId)

  if (!integration?.base_url || !integration.access_token) {
    throw new Error("CANVAS_REAUTH_REQUIRED: Connect Canvas with a base URL and access token before importing planner items.")
  }

  if (integration.status !== "connected") {
    throw new Error("CANVAS_REAUTH_REQUIRED: Reconnect Canvas before importing planner items.")
  }

  try {
    const now = new Date()
    const start = new Date(now)
    start.setDate(start.getDate() - CANVAS_IMPORT_PAST_DAYS)
    const end = new Date(now)
    end.setDate(end.getDate() + CANVAS_IMPORT_FUTURE_DAYS)

    const plannerItems = await fetchCanvasPaginated<CanvasPlannerItem>({
      baseUrl: integration.base_url,
      accessToken: integration.access_token,
      path: "/api/v1/planner/items",
      params: {
        start_date: dateOnly(start),
        end_date: dateOnly(end),
        per_page: "100",
      },
      maxPages: 6,
    })
    const candidatesToSync = canvasPlannerItemsToCandidates(plannerItems, integration.base_url)
    const sourceSnapshot = await insertSourceSnapshot({
      adminClient,
      userId,
      source: "canvas",
      sourceRef: integration.base_url,
      freshness: "fresh",
      summary: `Canvas planner refresh started for ${integration.base_name ?? integration.base_url}.`,
      payload: {
        baseUrl: integration.base_url,
        horizonStart: dateOnly(start),
        horizonEnd: dateOnly(end),
        rawItemCount: plannerItems.length,
        candidateCount: candidatesToSync.length,
      },
    })
    const existingByKey = await fetchExistingCanvasCandidates(userId)
    const syncedCandidates: SourceCandidate[] = []

    for (const candidate of candidatesToSync) {
      const result = await upsertCanvasTaskCandidate({
        userId,
        sourceSnapshotId: sourceSnapshot.id,
        candidate,
        existing: existingByKey.get(candidate.key) ?? null,
      })
      syncedCandidates.push(result.candidate)
    }

    const { error: snapshotUpdateError } = await adminClient
      .from("source_snapshots")
      .update({
        summary: buildSummary({
          rawCount: plannerItems.length,
          candidateCount: candidatesToSync.length,
          createdOrUpdated: syncedCandidates.length,
          baseName: integration.base_name,
        }),
        payload: {
          baseUrl: integration.base_url,
          horizonStart: dateOnly(start),
          horizonEnd: dateOnly(end),
          rawItemCount: plannerItems.length,
          candidateCount: candidatesToSync.length,
          syncedTaskCount: syncedCandidates.length,
        },
      })
      .eq("id", sourceSnapshot.id)
      .eq("user_id", userId)

    if (snapshotUpdateError) {
      throw new Error(snapshotUpdateError.message)
    }

    const { error: integrationUpdateError } = await adminClient
      .from("integrations")
      .update({
        status: "connected",
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("provider", "canvas")

    if (integrationUpdateError) {
      throw new Error(integrationUpdateError.message)
    }

    return {
      success: true,
      sourceSnapshot: {
        ...sourceSnapshot,
        summary: buildSummary({
          rawCount: plannerItems.length,
          candidateCount: candidatesToSync.length,
          createdOrUpdated: syncedCandidates.length,
          baseName: integration.base_name,
        }),
      },
      sourceFile: null,
      candidates: syncedCandidates,
    }
  } catch (error) {
    if (error instanceof CanvasApiError && error.reauthorizationRequired) {
      await markCanvasIntegrationStatus({
        userId,
        status: "needs_reauth",
      })
      throw new Error(`CANVAS_REAUTH_REQUIRED: ${error.message}`, { cause: error })
    }

    throw error
  }
}
