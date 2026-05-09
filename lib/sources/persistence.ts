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
import type { requireAuthenticatedUser } from "@/lib/supabase/auth"
import { TASKS_CALENDAR_ID } from "@/lib/task-calendar-constants"
import type {
  MemoryItemRow,
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

function candidateTags(candidate: SourceCandidate) {
  return Array.from(
    new Set(
      [
        "source-review",
        candidate.kind,
        candidate.course?.trim() || null,
      ].filter((tag): tag is string => Boolean(tag)),
    ),
  )
}

function isTaskCandidate(kind: SourceCandidateKind) {
  return kind === "task" || kind === "deadline" || kind === "event"
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

function candidateToTaskInsert(candidate: SourceCandidate, userId: string): TaskInsertRow {
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
    all_day: false,
    calendar_id: TASKS_CALENDAR_ID,
    tags: candidateTags(candidate),
    source_snapshot_id: candidate.sourceSnapshotId,
    source_candidate_id: candidate.id,
    plan_id: null,
  }
}

function candidateToMemoryInsert(candidate: SourceCandidate, userId: string): Omit<MemoryItemRow, "id" | "created_at" | "updated_at" | "supersedes_id" | "expires_at"> {
  return {
    user_id: userId,
    kind: candidate.kind === "preference" ? "preference" : "source_observation",
    category: candidate.kind,
    content: [candidate.title, candidate.description, candidate.evidence]
      .filter((part): part is string => Boolean(part))
      .join("\n"),
    importance: candidate.priority === "high" ? "high" : "medium",
    importance_note: candidate.confidence === null ? null : `Source confidence ${Math.round(candidate.confidence * 100)}%`,
    confidence: candidate.confidence,
    source_label: candidate.sourceSnapshotId ? "source_candidate" : "manual",
    source_ref: candidate.id,
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
  status: "processing" | "processed" | "failed"
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

export async function insertSourceCandidates(input: {
  adminClient: AdminClient
  userId: string
  sourceSnapshotId: string
  sourceFileId?: string | null
  candidates: ExtractedSourceCandidate[]
}): Promise<SourceCandidate[]> {
  if (input.candidates.length === 0) {
    return []
  }

  const titles = Array.from(new Set(input.candidates.map((candidate) => candidate.title.trim()).filter(Boolean)))
  const existingKeys = new Set<string>()

  if (titles.length > 0) {
    const { data: existingRows, error: existingError } = await input.adminClient
      .from("source_candidates")
      .select(SOURCE_CANDIDATE_SELECT)
      .eq("user_id", input.userId)
      .in("title", titles)
      .neq("status", "dismissed")
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
        payload: {},
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
  const taskCandidates = candidates.filter((candidate) => isTaskCandidate(candidate.kind))
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

  for (const candidate of memoryCandidates) {
    const { error: memoryError } = await input.adminClient
      .from("memory_items")
      .insert(candidateToMemoryInsert(candidate, input.userId))

    if (memoryError) {
      throw new Error(memoryError.message)
    }

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
