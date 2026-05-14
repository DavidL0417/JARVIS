import { describe, expect, it } from "vitest"

import { MEMORY_LAYER_ORDER } from "../lib/assistant/context"
import {
  DEFAULT_SECRETARY_MEMORY,
  DEFAULT_TEMPLATE_SOURCE,
} from "../lib/assistant/default-memory"

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
