import { describe, expect, it } from "vitest"

import { buildSupersedeOps, type ConsolidationCluster } from "../lib/assistant/memory-consolidation"
import type { MemoryItemRow, MemoryLayer } from "../types"

function row(id: string, layer: MemoryLayer): MemoryItemRow {
  return {
    id,
    user_id: "user-1",
    kind: "preference",
    layer,
    category: "general",
    content: `content ${id}`,
    importance: "medium",
    importance_note: null,
    confidence: null,
    source_label: "master_input",
    source_ref: null,
    payload: {},
    status: "active",
    supersedes_id: null,
    expires_at: null,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
  }
}

describe("buildSupersedeOps", () => {
  it("retires same-layer redundants into the canonical", () => {
    const rows = [row("a", "durable_preferences"), row("b", "durable_preferences"), row("c", "durable_preferences")]
    const clusters: ConsolidationCluster[] = [
      { canonicalId: "a", redundantIds: ["b", "c"], reason: "same fact" },
    ]

    const ops = buildSupersedeOps(rows, clusters)

    expect(ops).toEqual([
      { redundantId: "b", canonicalId: "a", layer: "durable_preferences" },
      { redundantId: "c", canonicalId: "a", layer: "durable_preferences" },
    ])
  })

  it("never retires across layers", () => {
    const rows = [row("a", "durable_preferences"), row("b", "operating_rules")]
    const clusters: ConsolidationCluster[] = [{ canonicalId: "a", redundantIds: ["b"], reason: "x" }]

    expect(buildSupersedeOps(rows, clusters)).toEqual([])
  })

  it("ignores unknown ids and a canonical listed as its own redundant", () => {
    const rows = [row("a", "durable_preferences")]
    const clusters: ConsolidationCluster[] = [
      { canonicalId: "a", redundantIds: ["a", "missing"], reason: "x" },
    ]

    expect(buildSupersedeOps(rows, clusters)).toEqual([])
  })

  it("retires each redundant at most once across clusters", () => {
    const rows = [row("a", "durable_preferences"), row("b", "durable_preferences"), row("c", "durable_preferences")]
    const clusters: ConsolidationCluster[] = [
      { canonicalId: "a", redundantIds: ["b"], reason: "x" },
      { canonicalId: "c", redundantIds: ["b"], reason: "y" },
    ]

    const ops = buildSupersedeOps(rows, clusters)
    expect(ops.filter((op) => op.redundantId === "b")).toHaveLength(1)
  })

  it("drops a surviving canonical that another cluster also retires", () => {
    const rows = [row("a", "durable_preferences"), row("b", "durable_preferences"), row("c", "durable_preferences")]
    // 'b' is retired by cluster 1 but is the canonical of cluster 2 — contradictory.
    const clusters: ConsolidationCluster[] = [
      { canonicalId: "a", redundantIds: ["b"], reason: "x" },
      { canonicalId: "b", redundantIds: ["c"], reason: "y" },
    ]

    const ops = buildSupersedeOps(rows, clusters)
    // Only the op that retires 'b' survives; the op pointing TO canonical 'b' is dropped.
    expect(ops).toEqual([{ redundantId: "b", canonicalId: "a", layer: "durable_preferences" }])
  })
})
