import { describe, expect, it } from "vitest"

import { MEMORY_LAYER_ORDER, selectPlannerMemories } from "../lib/assistant/context"
import {
  DEFAULT_SECRETARY_MEMORY,
  DEFAULT_TEMPLATE_SOURCE,
} from "../lib/assistant/default-memory"
import type { MemoryEntrySummary, MemoryImportance, MemoryLayer } from "../types"

function memory(
  overrides: Partial<MemoryEntrySummary> & { layer: MemoryLayer; importance: MemoryImportance },
): MemoryEntrySummary {
  return {
    id: overrides.insight ?? `m-${overrides.layer}-${overrides.importance}`,
    kind: "rule",
    category: "general",
    insight: "note",
    importanceNote: null,
    source: "test",
    confidence: null,
    payload: {},
    createdAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("selectPlannerMemories", () => {
  it("prioritizes higher layers and importance, and caps per layer + total", () => {
    const entries: MemoryEntrySummary[] = [
      ...Array.from({ length: 30 }, (_unused, index) =>
        memory({ layer: "candidate_memories", importance: "low", insight: `cand-${index}` }),
      ),
      memory({ layer: "operating_rules", importance: "critical", insight: "rule-critical" }),
      memory({ layer: "operating_rules", importance: "low", insight: "rule-low" }),
      memory({ layer: "deadline_context", importance: "high", insight: "deadline" }),
    ]

    const selected = selectPlannerMemories(entries)

    expect(selected.length).toBeLessThanOrEqual(60)
    expect(selected.filter((entry) => entry.layer === "candidate_memories").length).toBeLessThanOrEqual(5)

    const ruleCriticalIndex = selected.findIndex((entry) => entry.insight === "rule-critical")
    const ruleLowIndex = selected.findIndex((entry) => entry.insight === "rule-low")
    const deadlineIndex = selected.findIndex((entry) => entry.insight === "deadline")
    expect(ruleCriticalIndex).toBeGreaterThanOrEqual(0)
    expect(ruleCriticalIndex).toBeLessThan(ruleLowIndex)
    expect(ruleLowIndex).toBeLessThan(deadlineIndex)
  })

  it("collapses exact-duplicate insights, keeping the highest-priority copy", () => {
    const entries: MemoryEntrySummary[] = [
      memory({ layer: "operating_rules", importance: "low", insight: "Protect near-term deadlines." }),
      memory({ layer: "operating_rules", importance: "critical", insight: "protect near-term deadlines." }),
      memory({ layer: "operating_rules", importance: "high", insight: "Protect near-term deadlines.   " }),
      memory({ layer: "deadline_context", importance: "high", insight: "Unique note." }),
    ]

    const selected = selectPlannerMemories(entries)

    const dupes = selected.filter(
      (entry) => entry.insight.trim().toLowerCase() === "protect near-term deadlines.",
    )
    expect(dupes).toHaveLength(1)
    expect(dupes[0]?.importance).toBe("critical")
    expect(selected.some((entry) => entry.insight === "Unique note.")).toBe(true)
  })
})

describe("layered secretary context defaults", () => {
  it("loads secretary memory in Codex Scheduler order", () => {
    expect(MEMORY_LAYER_ORDER).toEqual([
      "operating_rules",
      "planning_profile",
      "durable_preferences",
      "task_context",
      "deadline_context",
      "calendar_context",
      "source_status",
      "feedback_observations",
      "candidate_memories",
    ])
  })

  it("seeds a reusable student template without David-specific facts", () => {
    const serialized = JSON.stringify(DEFAULT_SECRETARY_MEMORY).toLowerCase()

    expect(DEFAULT_TEMPLATE_SOURCE).toBe("default_secretary_template")
    expect(serialized).not.toContain("david")
    expect(serialized).not.toContain("northwestern")
    expect(serialized).not.toContain("enrep")
    expect(serialized).not.toContain("davidx")
    expect(serialized).not.toContain("homework database")
  })

  it("uses stable source refs so the seed is idempotent", () => {
    const sourceRefs = DEFAULT_SECRETARY_MEMORY.map((item) => item.sourceRef)

    expect(new Set(sourceRefs).size).toBe(sourceRefs.length)
    expect(sourceRefs.every((sourceRef) => sourceRef.includes(":"))).toBe(true)
  })
})
