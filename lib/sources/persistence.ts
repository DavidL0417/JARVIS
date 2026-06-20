import {
  mapSourceCandidateRowToCandidate,
  mapSourceFileRowToSummary,
  mapSourceSnapshotRowToSummary,
  mapTaskRowToTask,
  SOURCE_CANDIDATE_SELECT,
  SOURCE_FILE_SELECT,
  SOURCE_SNAPSHOT_SELECT,
  TASK_SELECT,
} from "@/lib/data/mappers"
import { insertMemoryItem } from "@/lib/assistant/memory-write"
import { findDuplicateCommitment, type CommitmentRef } from "@/lib/dedupe"
import type { requireAuthenticatedUser } from "@/lib/supabase/auth"
import { listScheduleEventRowsInWindow } from "@/lib/supabase/schedule-events"
import { TASKS_CALENDAR_ID } from "@/lib/task-calendar-constants"
import type {
  MemoryItemRow,
  ScheduleEventInsertRow,
  SourceCandidate,
  SourceCandidateKind,
  SourceCandidateRow,
  SourceFileRow,
  SourceFileSummary,
  SourceFreshness,
  SourceKind,
  SourceSnapshotRow,
  SourceSnapshotSummary,
  Task,
  TaskInsertRow,
  TaskRow,
  TaskSyncOrigin,
} from "@/types"
import type { ExtractedSourceCandidate } from "@/lib/sources/extraction"

type AdminClient = Awaited<ReturnType<typeof requireAuthenticatedUser>>["adminClient"]

function normalizeNullableText(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function candidateDescription(candidate: SourceCandidate) {
  return [
    candidate.description,
    candidate.course ? `Course: ${candidate.course}` : null,
    candidate.evidence ? `Evidence: ${candidate.evidence}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n\n") || null
}

// Imported tasks arrive confirmed (no provisional "source-review" gate). A bulk
// Canvas import would otherwise turn the whole task rail into a confirm/reject
// queue; trust the importer and let the normal delete handle mistakes.
function candidateTags(candidate: SourceCandidate) {
  return Array.from(
    new Set(
      [
        candidate.kind,
        candidate.course?.trim() || null,
      ].filter((tag): tag is string => Boolean(tag)),
    ),
  )
}

function isTaskCandidate(kind: SourceCandidateKind) {
  return kind === "task" || kind === "deadline" || kind === "event"
}

const AUTO_APPROVE_CONFIDENCE_THRESHOLD = 0.85

function isAutoApprovableCandidate(candidate: SourceCandidate) {
  if (!isTaskCandidate(candidate.kind)) {
    return false
  }

  if (!candidate.dueAt) {
    return false
  }

  if (candidate.confidence === null) {
    return false
  }

  return candidate.confidence >= AUTO_APPROVE_CONFIDENCE_THRESHOLD
}

function candidateKey(input: {
  kind: SourceCandidateKind
  title: string
  dueAt: string | null
  course: string | null
}) {
  return [
    input.kind,
    input.title.trim().toLowerCase(),
    input.dueAt ?? "",
    input.course?.trim().toLowerCase() ?? "",
  ].join("|")
}

// A structured importer (e.g. Notion) stashes the upstream record id + origin in
// the candidate payload. Carrying it onto the task as external_task_id /
// last_synced_from is what lets a later sync match this task back to its source
// row (so a Notion completion can complete the task, and vice versa).
function candidatePayloadLink(candidate: SourceCandidate): { externalId: string | null; lastSyncedFrom?: TaskSyncOrigin } {
  const externalId = typeof candidate.payload?.externalId === "string" ? candidate.payload.externalId : null
  const source = candidate.payload?.externalSource
  const lastSyncedFrom =
    source === "notion" ||
    source === "caldav" ||
    source === "apple_reminders" ||
    source === "gmail" ||
    source === "canvas"
      ? source
      : undefined
  return { externalId, lastSyncedFrom }
}

function candidateToTaskInsert(candidate: SourceCandidate, userId: string): TaskInsertRow {
  const isMultiDay = (candidate.durationMinutes ?? 0) >= 1440
  const isDateOnlyDeadline = candidate.kind === "deadline" && Boolean(candidate.dueAt && /T00:00:00\.000Z$/.test(candidate.dueAt))
  const allDay = isMultiDay || isDateOnlyDeadline
  const { externalId, lastSyncedFrom } = candidatePayloadLink(candidate)
  return {
    user_id: userId,
    title: candidate.title,
    description: candidateDescription(candidate),
    deadline: candidate.kind === "deadline" || candidate.kind === "task" ? candidate.dueAt : null,
    duration_minutes: candidate.durationMinutes,
    priority: candidate.priority,
    status: candidate.kind === "event" && candidate.dueAt ? "scheduled" : "todo",
    scheduled_for: candidate.kind === "event" ? candidate.dueAt : null,
    is_immutable: candidate.kind === "event" && Boolean(candidate.dueAt),
    all_day: allDay,
    calendar_id: TASKS_CALENDAR_ID,
    tags: candidateTags(candidate),
    source_snapshot_id: candidate.sourceSnapshotId,
    source_candidate_id: candidate.id,
    plan_id: null,
    external_task_id: externalId,
    ...(lastSyncedFrom ? { last_synced_from: lastSyncedFrom } : {}),
  }
}

// An event-kind candidate with a concrete time becomes a real calendar event,
// not a task. It lands provisional (is_checked_in=false) but immutable — the
// planner treats it as a fixed commitment immediately; confirm only clears the
// "JARVIS added this" marker. source="imported" keeps it off the task-block
// churn and the Google/CalDAV mirror reconcilers.
function candidateToScheduleEventInsert(candidate: SourceCandidate, userId: string): ScheduleEventInsertRow {
  const startIso = candidate.dueAt as string
  const start = new Date(startIso)
  const isDateOnly = /T00:00:00\.000Z$/.test(startIso)
  const isMultiDay = (candidate.durationMinutes ?? 0) >= 1440
  const allDay = isMultiDay || isDateOnly
  const durationMinutes = candidate.durationMinutes ?? (allDay ? 1440 : 60)
  const end = new Date(start.getTime() + durationMinutes * 60_000)

  return {
    user_id: userId,
    task_id: null,
    title: candidate.title,
    starts_at: startIso,
    ends_at: end.toISOString(),
    source: "imported",
    priority: candidate.priority,
    status: "scheduled",
    location: null,
    external_event_id: null,
    gcal_event_id: null,
    last_synced_from: "local",
    is_immutable: true,
    is_checked_in: false,
    all_day: allDay,
    calendar_id: TASKS_CALENDAR_ID,
  }
}

// Event-kind candidates route to the calendar only when they carry a concrete
// time. A timeless "event" falls back to the task path (a plain todo).
function isImportedEventCandidate(candidate: SourceCandidate) {
  return candidate.kind === "event" && Boolean(candidate.dueAt)
}

function candidateToMemoryInsert(candidate: SourceCandidate, userId: string): Omit<MemoryItemRow, "id" | "created_at" | "updated_at" | "supersedes_id" | "expires_at"> {
  const layer = candidate.kind === "preference" ? "durable_preferences" : "candidate_memories"

  return {
    user_id: userId,
    kind: candidate.kind === "preference" ? "preference" : "source_observation",
    layer,
    category: candidate.kind,
    content: [candidate.title, candidate.description, candidate.evidence]
      .filter((part): part is string => Boolean(part))
      .join("\n"),
    importance: candidate.priority === "high" ? "high" : "medium",
    importance_note: candidate.confidence === null ? null : `Source confidence ${Math.round(candidate.confidence * 100)}%`,
    confidence: candidate.confidence,
    source_label: candidate.sourceSnapshotId ? "source_candidate" : "manual",
    source_ref: candidate.id,
    payload: {
      sourceCandidateId: candidate.id,
      sourceSnapshotId: candidate.sourceSnapshotId,
      sourceFileId: candidate.sourceFileId,
      promotedLayer: layer,
    },
    status: "active",
  }
}

export async function insertSourceSnapshot(input: {
  adminClient: AdminClient
  userId: string
  source: SourceKind
  sourceRef?: string | null
  freshness: SourceFreshness
  summary: string
  payload?: Record<string, unknown>
}): Promise<SourceSnapshotSummary> {
  const { data, error } = await input.adminClient
    .from("source_snapshots")
    .insert({
      user_id: input.userId,
      source: input.source,
      source_ref: normalizeNullableText(input.sourceRef),
      freshness: input.freshness,
      summary: input.summary,
      payload: input.payload ?? {},
    })
    .select(SOURCE_SNAPSHOT_SELECT)
    .single<SourceSnapshotRow>()

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to record source snapshot.")
  }

  return mapSourceSnapshotRowToSummary(data)
}

export async function insertSourceFile(input: {
  adminClient: AdminClient
  userId: string
  source: SourceKind
  sourceRef?: string | null
  fileName: string
  mimeType: string
  storagePath: string
  sizeBytes: number
  status: "ready" | "processing" | "processed" | "failed"
  errorMessage?: string | null
}): Promise<SourceFileSummary> {
  const { data, error } = await input.adminClient
    .from("source_files")
    .insert({
      user_id: input.userId,
      source: input.source,
      source_ref: normalizeNullableText(input.sourceRef),
      file_name: input.fileName,
      mime_type: input.mimeType,
      storage_path: input.storagePath,
      size_bytes: input.sizeBytes,
      status: input.status,
      error_message: normalizeNullableText(input.errorMessage),
    })
    .select(SOURCE_FILE_SELECT)
    .single<SourceFileRow>()

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to record source file.")
  }

  return mapSourceFileRowToSummary(data)
}

export async function updateSourceFileStatus(input: {
  adminClient: AdminClient
  userId: string
  sourceFileId: string
  status: "processed" | "failed"
  errorMessage?: string | null
}): Promise<SourceFileSummary> {
  const { data, error } = await input.adminClient
    .from("source_files")
    .update({
      status: input.status,
      error_message: normalizeNullableText(input.errorMessage),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.sourceFileId)
    .eq("user_id", input.userId)
    .select(SOURCE_FILE_SELECT)
    .single<SourceFileRow>()

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to update source file status.")
  }

  return mapSourceFileRowToSummary(data)
}

// Candidate payload: external id (per-item link, e.g. a Notion page) + origin (so
// the approved task gets last_synced_from). A per-candidate externalSource wins
// over the batch-level one passed by the importer.
function candidateInsertPayload(
  candidate: ExtractedSourceCandidate,
  batchSource: TaskSyncOrigin | undefined,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  if (candidate.externalId) {
    payload.externalId = candidate.externalId
  }
  const source = candidate.externalSource ?? batchSource
  if (source) {
    payload.externalSource = source
  }
  return payload
}

export async function insertSourceCandidates(input: {
  adminClient: AdminClient
  userId: string
  sourceSnapshotId: string
  sourceFileId?: string | null
  candidates: ExtractedSourceCandidate[]
  // Stamps task provenance (last_synced_from) for sources that don't carry a
  // per-item external id — e.g. Gmail, Canvas. Per-candidate externalSource wins.
  externalSource?: TaskSyncOrigin
}): Promise<SourceCandidate[]> {
  if (input.candidates.length === 0) {
    return []
  }

  const existingKeys = new Set<string>()

  // Dismissed candidates count toward the dedup key: dismissing an item is
  // permanent, so the same (kind, title, due, course) never re-imports on a
  // later refresh. A changed due date yields a new key and surfaces again.
  const { data: existingRows, error: existingError } = await input.adminClient
    .from("source_candidates")
    .select(SOURCE_CANDIDATE_SELECT)
    .eq("user_id", input.userId)
    .limit(2000)
    .returns<SourceCandidateRow[]>()

  if (existingError) {
    throw new Error(existingError.message)
  }

  for (const candidate of (existingRows || []).map(mapSourceCandidateRowToCandidate)) {
    existingKeys.add(candidateKey({
      kind: candidate.kind,
      title: candidate.title,
      dueAt: candidate.dueAt,
      course: candidate.course,
    }))
  }

  const candidatesToInsert = input.candidates.filter((candidate) => {
    const key = candidateKey({
      kind: candidate.kind,
      title: candidate.title,
      dueAt: candidate.dueAt,
      course: candidate.course,
    })

    if (existingKeys.has(key)) {
      return false
    }

    existingKeys.add(key)
    return true
  })

  if (candidatesToInsert.length === 0) {
    return []
  }

  const { data, error } = await input.adminClient
    .from("source_candidates")
    .insert(
      candidatesToInsert.map((candidate) => ({
        user_id: input.userId,
        source_snapshot_id: input.sourceSnapshotId,
        source_file_id: input.sourceFileId ?? null,
        kind: candidate.kind,
        title: candidate.title,
        description: normalizeNullableText(candidate.description),
        course: normalizeNullableText(candidate.course),
        due_at: candidate.dueAt,
        duration_minutes: candidate.durationMinutes,
        priority: candidate.priority,
        confidence: candidate.confidence,
        evidence: normalizeNullableText(candidate.evidence),
        // Keep the upstream link (external id) + origin so the approved task can
        // carry external_task_id / last_synced_from. externalSource also tags
        // id-less sources (Gmail, Canvas) for provenance grouping.
        payload: candidateInsertPayload(candidate, input.externalSource),
        status: "pending",
      })),
    )
    .select(SOURCE_CANDIDATE_SELECT)
    .returns<SourceCandidateRow[]>()

  if (error) {
    throw new Error(error.message)
  }

  return (data || []).map(mapSourceCandidateRowToCandidate)
}

// Everything the user already has on the books, for duplicate checks: open tasks
// (by deadline or scheduled time) plus upcoming calendar events. Capped windows keep
// this cheap; it runs once per refresh/import.
export async function loadExistingCommitments(
  adminClient: AdminClient,
  userId: string,
): Promise<CommitmentRef[]> {
  const [tasksResult, eventsResult] = await Promise.all([
    adminClient
      .from("tasks")
      .select("title, deadline, scheduled_for")
      .eq("user_id", userId)
      .in("status", ["todo", "scheduled"])
      .limit(300),
    listScheduleEventRowsInWindow(adminClient, userId, { lookbackDays: 7, lookaheadDays: 120 }),
  ])

  if (tasksResult.error) {
    throw new Error(tasksResult.error.message)
  }
  if (eventsResult.error) {
    throw new Error(eventsResult.error.message)
  }

  const taskRefs: CommitmentRef[] = (tasksResult.data ?? []).map(
    (row: { title: string; deadline: string | null; scheduled_for: string | null }) => ({
      title: row.title,
      at: row.scheduled_for ?? row.deadline ?? null,
    }),
  )
  const eventRefs: CommitmentRef[] = (eventsResult.data ?? []).map((row) => ({
    title: row.title,
    at: row.starts_at,
  }))

  return [...taskRefs, ...eventRefs]
}

export async function insertAndAutoApproveSourceCandidates(input: {
  adminClient: AdminClient
  userId: string
  sourceSnapshotId: string
  sourceFileId?: string | null
  candidates: ExtractedSourceCandidate[]
  externalSource?: TaskSyncOrigin
}): Promise<SourceCandidate[]> {
  const inserted = await insertSourceCandidates(input)

  if (inserted.length === 0) {
    return inserted
  }

  const autoApprovable = inserted.filter(isAutoApprovableCandidate)

  // Duplicate gate: a candidate that looks like an existing task/event (or like a
  // candidate approved earlier in this same batch) is not auto-approved.
  // Six emails about one piano jury → one task, not six.
  const existingCommitments = await loadExistingCommitments(input.adminClient, input.userId)
  const autoIds: string[] = []

  for (const candidate of autoApprovable) {
    const ref: CommitmentRef = { title: candidate.title, at: candidate.dueAt }

    if (findDuplicateCommitment(ref, existingCommitments)) {
      continue
    }

    existingCommitments.push(ref)
    autoIds.push(candidate.id)
  }

  const approvedById = new Map<string, SourceCandidate>()
  if (autoIds.length > 0) {
    const { candidates: approved } = await approveSourceCandidates({
      adminClient: input.adminClient,
      userId: input.userId,
      candidateIds: autoIds,
    })
    for (const candidate of approved) {
      approvedById.set(candidate.id, candidate)
    }
  }

  // Auto-approve-only design (Option A, 2026-06-19, David's call): there is no
  // manual review queue, so any inserted candidate that did NOT auto-approve is
  // retired to `dismissed` now instead of lingering as a stranded `pending` row
  // (which only ever inflated a count badge with no consumer). The row is kept —
  // not deleted — so the cross-status unique dedup key still suppresses recreating
  // the same commitment on the next refresh. Canvas REST reclaims a still-live
  // dismissed candidate via fetchExistingCanvasCandidates (which now includes
  // dismissed) rather than colliding on insert.
  const leftoverIds = inserted
    .filter((candidate) => !approvedById.has(candidate.id))
    .map((candidate) => candidate.id)

  if (leftoverIds.length > 0) {
    const { error: dismissError } = await input.adminClient
      .from("source_candidates")
      .update({ status: "dismissed", updated_at: new Date().toISOString() })
      .eq("user_id", input.userId)
      .in("id", leftoverIds)
      .eq("status", "pending")

    if (dismissError) {
      throw new Error(dismissError.message)
    }
  }

  return inserted.map(
    (candidate) => approvedById.get(candidate.id) ?? { ...candidate, status: "dismissed" as const },
  )
}

export async function undoSourceCandidateApproval(input: {
  adminClient: AdminClient
  userId: string
  candidateIds: string[]
}): Promise<{ candidates: SourceCandidate[]; deletedTaskIds: string[] }> {
  const { data: candidateRows, error: fetchError } = await input.adminClient
    .from("source_candidates")
    .select(SOURCE_CANDIDATE_SELECT)
    .eq("user_id", input.userId)
    .in("id", input.candidateIds)
    .eq("status", "approved")
    .returns<SourceCandidateRow[]>()

  if (fetchError) {
    throw new Error(fetchError.message)
  }

  const candidates = (candidateRows || []).map(mapSourceCandidateRowToCandidate)

  if (candidates.length === 0) {
    return { candidates: [], deletedTaskIds: [] }
  }

  const taskIds = candidates
    .map((candidate) => candidate.approvedTaskId)
    .filter((taskId): taskId is string => Boolean(taskId))
  const eventIds = candidates
    .map((candidate) => candidate.approvedEventId)
    .filter((eventId): eventId is string => Boolean(eventId))

  if (taskIds.length > 0) {
    const { error: eventDeleteError } = await input.adminClient
      .from("schedule_events")
      .delete()
      .eq("user_id", input.userId)
      .in("task_id", taskIds)

    if (eventDeleteError) {
      throw new Error(eventDeleteError.message)
    }

    const { error: taskDeleteError } = await input.adminClient
      .from("tasks")
      .delete()
      .eq("user_id", input.userId)
      .in("id", taskIds)

    if (taskDeleteError) {
      throw new Error(taskDeleteError.message)
    }
  }

  // Imported event-kind candidates created a calendar event, not a task.
  if (eventIds.length > 0) {
    const { error: importedEventDeleteError } = await input.adminClient
      .from("schedule_events")
      .delete()
      .eq("user_id", input.userId)
      .in("id", eventIds)

    if (importedEventDeleteError) {
      throw new Error(importedEventDeleteError.message)
    }
  }

  const now = new Date().toISOString()
  const { data: updatedRows, error: updateError } = await input.adminClient
    .from("source_candidates")
    .update({
      status: "dismissed",
      approved_task_id: null,
      approved_event_id: null,
      updated_at: now,
    })
    .eq("user_id", input.userId)
    .in("id", candidates.map((candidate) => candidate.id))
    .select(SOURCE_CANDIDATE_SELECT)
    .returns<SourceCandidateRow[]>()

  if (updateError) {
    throw new Error(updateError.message)
  }

  return {
    candidates: (updatedRows || []).map(mapSourceCandidateRowToCandidate),
    deletedTaskIds: taskIds,
  }
}

export async function approveSourceCandidates(input: {
  adminClient: AdminClient
  userId: string
  candidateIds: string[]
}): Promise<{ tasks: Task[]; candidates: SourceCandidate[] }> {
  const { data: candidateRows, error: candidateError } = await input.adminClient
    .from("source_candidates")
    .select(SOURCE_CANDIDATE_SELECT)
    .eq("user_id", input.userId)
    .in("id", input.candidateIds)
    .eq("status", "pending")
    .returns<SourceCandidateRow[]>()

  if (candidateError) {
    throw new Error(candidateError.message)
  }

  const candidates = (candidateRows || []).map(mapSourceCandidateRowToCandidate)
  const eventCandidates = candidates.filter(isImportedEventCandidate)
  const taskCandidates = candidates.filter(
    (candidate) => isTaskCandidate(candidate.kind) && !isImportedEventCandidate(candidate),
  )
  const memoryCandidates = candidates.filter((candidate) => !isTaskCandidate(candidate.kind))
  const tasks: Task[] = []
  const now = new Date().toISOString()

  for (const candidate of taskCandidates) {
    const { data, error } = await input.adminClient
      .from("tasks")
      .insert(candidateToTaskInsert(candidate, input.userId))
      .select(TASK_SELECT)
      .single<TaskRow>()

    if (error || !data) {
      throw new Error(error?.message ?? `Failed to approve candidate ${candidate.id}.`)
    }

    const task = mapTaskRowToTask(data)
    tasks.push(task)

    const { error: updateError } = await input.adminClient
      .from("source_candidates")
      .update({
        status: "approved",
        approved_task_id: task.id,
        updated_at: now,
      })
      .eq("id", candidate.id)
      .eq("user_id", input.userId)

    if (updateError) {
      throw new Error(updateError.message)
    }
  }

  for (const candidate of eventCandidates) {
    const { data, error } = await input.adminClient
      .from("schedule_events")
      .insert(candidateToScheduleEventInsert(candidate, input.userId))
      .select("id")
      .single<{ id: string }>()

    if (error || !data) {
      throw new Error(error?.message ?? `Failed to approve event candidate ${candidate.id}.`)
    }

    const { error: updateError } = await input.adminClient
      .from("source_candidates")
      .update({
        status: "approved",
        approved_event_id: data.id,
        updated_at: now,
      })
      .eq("id", candidate.id)
      .eq("user_id", input.userId)

    if (updateError) {
      throw new Error(updateError.message)
    }
  }

  for (const candidate of memoryCandidates) {
    // Through the shared gate: if this fact is already stored for the user+layer
    // the insert dedupes to a no-op, but the candidate is still marked approved.
    await insertMemoryItem(input.adminClient, { ...candidateToMemoryInsert(candidate, input.userId) })

    const { error: updateError } = await input.adminClient
      .from("source_candidates")
      .update({
        status: "approved",
        updated_at: now,
      })
      .eq("id", candidate.id)
      .eq("user_id", input.userId)

    if (updateError) {
      throw new Error(updateError.message)
    }
  }

  const { data: updatedRows, error: updatedError } = await input.adminClient
    .from("source_candidates")
    .select(SOURCE_CANDIDATE_SELECT)
    .eq("user_id", input.userId)
    .in("id", input.candidateIds)
    .returns<SourceCandidateRow[]>()

  if (updatedError) {
    throw new Error(updatedError.message)
  }

  return {
    tasks,
    candidates: (updatedRows || []).map(mapSourceCandidateRowToCandidate),
  }
}
