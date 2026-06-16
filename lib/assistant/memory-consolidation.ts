import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"

import { runClaudeStructuredExtraction } from "@/lib/ai/claude-extraction"
import { MEMORY_ITEM_SELECT } from "@/lib/data/mappers"
import type { MemoryItemRow, MemoryLayer } from "@/types"

type AdminClient = SupabaseClient

// Lifecycle convention for consolidation:
//   a retired row gets status='superseded' and supersedes_id = <the surviving
//   canonical row it was merged into>. Reads already filter status='active', so
//   retired rows drop out of the planner/drawer, and supersedes_id is the back-
//   pointer an audit or undo needs ("this note was merged into that one").
//   The Stage-1 unique index prevents EXACT dupes; this pass handles SEMANTIC
//   near-duplicates the index can't see (different wording, same fact).

export type ConsolidationCluster = {
  canonicalId: string
  redundantIds: string[]
  reason: string
}

export type SupersedeOp = {
  redundantId: string
  canonicalId: string
  layer: MemoryLayer
}

export type ConsolidationResult = {
  userId: string
  scanned: number
  superseded: number
  dryRun: boolean
  ops: SupersedeOp[]
  skipped?: "judge_unavailable"
}

const clusterSchema = z.object({
  canonicalId: z.string(),
  redundantIds: z.array(z.string()),
  reason: z.string(),
})
const consolidationOutputSchema = z.object({ clusters: z.array(clusterSchema) })

const CONSOLIDATION_TOOL_SCHEMA = {
  type: "object",
  properties: {
    clusters: {
      type: "array",
      description:
        "Groups of memory notes that state the SAME durable fact, preference, or rule and should be merged into one. Only include a group with 2+ members. Never group notes that merely share a topic.",
      items: {
        type: "object",
        properties: {
          canonicalId: {
            type: "string",
            description: "The id of the single clearest, most complete note in the group — the one to KEEP.",
          },
          redundantIds: {
            type: "array",
            items: { type: "string" },
            description: "Ids of the other notes in the group to retire. Must not include canonicalId.",
          },
          reason: { type: "string", description: "One sentence on why these state the same fact." },
        },
        required: ["canonicalId", "redundantIds", "reason"],
      },
    },
  },
  required: ["clusters"],
}

const CONSOLIDATION_SYSTEM_PROMPT = [
  "You de-duplicate a personal assistant's memory notes.",
  "You are given the user's active notes, each with an id and the layer it belongs to.",
  "Find groups where two or more notes state the SAME durable fact, preference, or rule in different words.",
  "Be conservative: only group notes that a careful person would agree are redundant restatements of one fact.",
  "Do NOT group notes that are merely related, sequential, or about the same topic but carry distinct information.",
  "NEVER group notes from different layers.",
  "For each group, pick the clearest, most complete note as canonical and list the rest as redundant.",
  "If nothing is redundant, return an empty clusters array.",
  "Reply only by calling the tool.",
].join("\n")

function compactContent(content: string): string {
  return content.replace(/\s+/g, " ").trim()
}

async function judgeNearDuplicates(rows: MemoryItemRow[]): Promise<ConsolidationCluster[]> {
  const listing = rows
    .map((row) => `- id=${row.id} | layer=${row.layer} | importance=${row.importance} | "${compactContent(row.content)}"`)
    .join("\n")

  const result = await runClaudeStructuredExtraction({
    system: CONSOLIDATION_SYSTEM_PROMPT,
    content: `Active memory notes:\n\n${listing}`,
    toolName: "report_duplicate_clusters",
    toolDescription: "Report groups of memory notes that are semantically the same fact and should be consolidated.",
    inputSchema: CONSOLIDATION_TOOL_SCHEMA,
    maxTokens: 1500,
  })

  const parsed = consolidationOutputSchema.safeParse(result.data)
  if (!parsed.success) {
    return []
  }
  return parsed.data.clusters
}

/**
 * Pure validation: turn the judge's proposed clusters into concrete supersede
 * operations, dropping anything unsafe. Guards:
 *  - canonical and every redundant must be in the loaded active set,
 *  - a redundant can't be its own canonical,
 *  - only retire within the same layer (the unique-index scope),
 *  - a row scheduled for retirement can't also be a surviving canonical,
 *  - each redundant is retired at most once.
 */
export function buildSupersedeOps(
  rows: MemoryItemRow[],
  clusters: ConsolidationCluster[],
): SupersedeOp[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const scheduled = new Set<string>()
  const ops: SupersedeOp[] = []

  for (const cluster of clusters) {
    const canonical = byId.get(cluster.canonicalId)
    if (!canonical) continue

    for (const redundantId of cluster.redundantIds) {
      if (redundantId === cluster.canonicalId) continue
      if (scheduled.has(redundantId)) continue
      const redundant = byId.get(redundantId)
      if (!redundant) continue
      if (redundant.layer !== canonical.layer) continue

      scheduled.add(redundantId)
      ops.push({ redundantId, canonicalId: cluster.canonicalId, layer: canonical.layer })
    }
  }

  // A surviving canonical must not also be retired by another cluster.
  return ops.filter((op) => !scheduled.has(op.canonicalId))
}

export async function listUsersWithActiveMemories(adminClient: AdminClient): Promise<string[]> {
  const { data, error } = await adminClient
    .from("memory_items")
    .select("user_id")
    .eq("status", "active")

  if (error) {
    throw new Error(error.message)
  }

  return Array.from(new Set((data ?? []).map((row) => row.user_id as string)))
}

export async function consolidateMemoriesForUser(input: {
  adminClient: AdminClient
  userId: string
  dryRun?: boolean
}): Promise<ConsolidationResult> {
  const { adminClient, userId } = input
  const dryRun = input.dryRun ?? false

  const { data, error } = await adminClient
    .from("memory_items")
    .select(MEMORY_ITEM_SELECT)
    .eq("user_id", userId)
    .eq("status", "active")
    .returns<MemoryItemRow[]>()

  if (error) {
    throw new Error(error.message)
  }

  const rows = data ?? []

  // Only layers with 2+ active rows can hold an intra-layer duplicate, so we
  // only send those to the judge — keeps the call small and cheap.
  const layerCounts = new Map<string, number>()
  for (const row of rows) {
    layerCounts.set(row.layer, (layerCounts.get(row.layer) ?? 0) + 1)
  }
  const candidateRows = rows.filter((row) => (layerCounts.get(row.layer) ?? 0) >= 2)

  if (candidateRows.length < 2) {
    return { userId, scanned: rows.length, superseded: 0, dryRun, ops: [] }
  }

  let clusters: ConsolidationCluster[]
  try {
    clusters = await judgeNearDuplicates(candidateRows)
  } catch {
    // Missing ANTHROPIC_API_KEY or a transient model failure — skip this user
    // rather than failing the whole sweep.
    return { userId, scanned: rows.length, superseded: 0, dryRun, ops: [], skipped: "judge_unavailable" }
  }

  const ops = buildSupersedeOps(candidateRows, clusters)

  if (dryRun || ops.length === 0) {
    return { userId, scanned: rows.length, superseded: 0, dryRun, ops }
  }

  const nowIso = new Date().toISOString()
  let superseded = 0

  for (const op of ops) {
    const { error: updateError } = await adminClient
      .from("memory_items")
      .update({ status: "superseded", supersedes_id: op.canonicalId, updated_at: nowIso })
      .eq("id", op.redundantId)
      .eq("user_id", userId)
      .eq("status", "active")

    if (updateError) {
      continue
    }

    superseded += 1
    await adminClient.from("change_logs").insert({
      user_id: userId,
      actor: "system",
      action: "memory.consolidate",
      target_table: "memory_items",
      target_id: op.redundantId,
      summary: "Retired a near-duplicate memory, merged into a canonical note.",
      after_value: { supersededBy: op.canonicalId, layer: op.layer },
      source_label: "memory_consolidation",
    })
  }

  return { userId, scanned: rows.length, superseded, dryRun, ops }
}
