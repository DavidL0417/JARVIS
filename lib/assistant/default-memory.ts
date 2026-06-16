import type { SupabaseClient } from "@supabase/supabase-js"

import { insertMemoryItem } from "@/lib/assistant/memory-write"
import type { MemoryImportance, MemoryKind, MemoryLayer } from "@/types"

export const DEFAULT_TEMPLATE_SOURCE = "default_secretary_template"

type DefaultMemorySeed = {
  sourceRef: string
  layer: MemoryLayer
  kind: MemoryKind
  category: string
  content: string
  importance: MemoryImportance
  importanceNote: string
  payload?: Record<string, unknown>
}

export const DEFAULT_SECRETARY_MEMORY: DefaultMemorySeed[] = [
  {
    sourceRef: "operating-rules:source-truth",
    layer: "operating_rules",
    kind: "rule",
    category: "source_authority",
    content:
      "Refresh canonical sources before high-stakes planning. Treat connected calendar events as fixed commitments, approved task rows as work to schedule, and source candidates as reviewable evidence until approved.",
    importance: "critical",
    importanceNote: "Hard planning rule; never assume missing source data means there is no work.",
    payload: { templateVersion: 1 },
  },
  {
    sourceRef: "operating-rules:approval",
    layer: "operating_rules",
    kind: "rule",
    category: "approval_policy",
    content:
      "In-app plans and task blocks may be written after an explicit scheduling command. External calendar writes, destructive changes, email sends, and unsupported source writes require explicit approval.",
    importance: "critical",
    importanceNote: "Protects external user data and keeps risky actions resumable.",
    payload: { templateVersion: 1 },
  },
  {
    sourceRef: "planning-profile:student",
    layer: "planning_profile",
    kind: "observation",
    category: "student_planning",
    content:
      "Default planning posture is student-centered: protect near-term assignments, exams, classes, commitments, sleep, recovery, and recurring routines before filling discretionary study time.",
    importance: "high",
    importanceNote: "Use as the default profile until the user's own habits supersede it.",
    payload: { templateVersion: 1 },
  },
  {
    sourceRef: "durable-preferences:zero-tradeoff",
    layer: "durable_preferences",
    kind: "preference",
    category: "tradeoffs",
    content:
      "Design for a zero-tradeoff plan first. If compression, deferral, omission, or sleep/routine sacrifice is unavoidable, name the concrete reason and risk.",
    importance: "high",
    importanceNote: "Default decision rule for schedule explanations.",
    payload: { templateVersion: 1 },
  },
  {
    sourceRef: "task-context:deadline-protection",
    layer: "deadline_context",
    kind: "task_context",
    category: "deadline_protection",
    content:
      "Before allocating flexible work, inspect incomplete tasks due today and in the near-term horizon. Earlier due work should not be erased by later exam or project pressure unless constraints force it.",
    importance: "high",
    importanceNote: "Prevents plans from over-weighting a single large future item.",
    payload: { templateVersion: 1 },
  },
  {
    sourceRef: "calendar-context:feedback",
    layer: "calendar_context",
    kind: "rule",
    category: "calendar_feedback",
    content:
      "When assistant-created blocks are moved, deleted, or shortened externally, record factual observations first. Propose memory updates only after repeated evidence.",
    importance: "medium",
    importanceNote: "Keeps adaptation visible rather than silently changing behavior.",
    payload: { templateVersion: 1 },
  },
  {
    sourceRef: "candidate-memories:promotion",
    layer: "candidate_memories",
    kind: "rule",
    category: "memory_promotion",
    content:
      "Promote memories only when they affect scheduling, prioritization, reminders, source interpretation, or secretary behavior. Keep one-off facts in task/source context.",
    importance: "medium",
    importanceNote: "Prevents clutter while preserving useful student-planning patterns.",
    payload: { templateVersion: 1 },
  },
]

export async function ensureDefaultSecretaryMemoryForUser(
  supabase: SupabaseClient,
  userId: string,
) {
  const seedRefs = DEFAULT_SECRETARY_MEMORY.map((item) => item.sourceRef)
  const { data, error } = await supabase
    .from("memory_items")
    .select("source_ref")
    .eq("user_id", userId)
    .eq("source_label", DEFAULT_TEMPLATE_SOURCE)
    .in("source_ref", seedRefs)

  if (error) {
    throw new Error(error.message)
  }

  const existingRefs = new Set((data ?? []).map((row) => row.source_ref).filter(Boolean))
  const rowsToInsert = DEFAULT_SECRETARY_MEMORY
    .filter((item) => !existingRefs.has(item.sourceRef))
    .map((item) => ({
      user_id: userId,
      kind: item.kind,
      layer: item.layer,
      category: item.category,
      content: item.content,
      importance: item.importance,
      importance_note: item.importanceNote,
      confidence: 1,
      source_label: DEFAULT_TEMPLATE_SOURCE,
      source_ref: item.sourceRef,
      payload: item.payload ?? {},
      status: "active",
    }))

  if (rowsToInsert.length === 0) {
    return { inserted: 0 }
  }

  // Insert one row at a time through the shared gate. The per-source_ref check
  // above is not atomic, so two concurrent first-load requests can both reach
  // here; the DB unique index makes the loser's rows dedupe to a no-op instead
  // of double-seeding. Per-row (not a single batch) so one conflicting seed
  // doesn't abort the insert of the others after a partial delete.
  let inserted = 0
  for (const row of rowsToInsert) {
    const { deduped } = await insertMemoryItem(supabase, { ...row })
    if (!deduped) {
      inserted += 1
    }
  }

  return { inserted }
}
