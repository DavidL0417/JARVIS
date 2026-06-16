import { describe, expect, it } from "vitest"

import { mapMemoryItemRowToDetail } from "@/lib/data/mappers"
import { buildMemoryUpdate } from "@/lib/data/memory-mutations"
import { memoryItemDetailSchema } from "@/schemas/common"
import type { MemoryItemRow, MemoryStatus } from "@/types"

const TS = "2026-06-15T00:00:00.000Z"

function makeRow(overrides: Partial<MemoryItemRow> = {}): MemoryItemRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    user_id: "00000000-0000-4000-8000-0000000000aa",
    kind: "preference",
    layer: "durable_preferences",
    category: "general",
    content: "Prefers mornings for deep work.",
    importance: "high",
    importance_note: "Affects how the day is sequenced.",
    confidence: null,
    source_label: "manual",
    source_ref: null,
    payload: {},
    status: "active",
    supersedes_id: null,
    expires_at: null,
    created_at: TS,
    updated_at: TS,
    ...overrides,
  }
}

describe("buildMemoryUpdate", () => {
  it("stamps user_edit only when the note text changes", () => {
    expect(buildMemoryUpdate({ insight: "new text" }, TS)).toEqual({
      updated_at: TS,
      content: "new text",
      source_label: "user_edit",
    })
  })

  it("does not relabel provenance on an importance-only edit", () => {
    const update = buildMemoryUpdate({ importance: "critical" }, TS)
    expect(update).toEqual({ updated_at: TS, importance: "critical" })
    expect(update).not.toHaveProperty("source_label")
    expect(update).not.toHaveProperty("content")
  })

  it("applies every provided field together", () => {
    expect(buildMemoryUpdate({ insight: "x", importance: "low", importanceNote: null }, TS)).toEqual({
      updated_at: TS,
      content: "x",
      source_label: "user_edit",
      importance: "low",
      importance_note: null,
    })
  })

  it("touches only updated_at when nothing else is provided", () => {
    expect(buildMemoryUpdate({}, TS)).toEqual({ updated_at: TS })
  })
})

describe("mapMemoryItemRowToDetail", () => {
  it("carries the lifecycle fields the summary mapper omits", () => {
    const detail = mapMemoryItemRowToDetail(
      makeRow({
        status: "superseded",
        supersedes_id: "00000000-0000-4000-8000-000000000002",
        expires_at: TS,
        updated_at: TS,
      }),
    )

    expect(detail).toMatchObject({
      insight: "Prefers mornings for deep work.",
      status: "superseded",
      supersedesId: "00000000-0000-4000-8000-000000000002",
      expiresAt: TS,
      updatedAt: TS,
    })
    expect(() => memoryItemDetailSchema.parse(detail)).not.toThrow()
  })

  it("round-trips every lifecycle status and falls back to active for junk", () => {
    const statuses: MemoryStatus[] = ["active", "candidate", "stale", "superseded", "archived"]
    for (const status of statuses) {
      expect(mapMemoryItemRowToDetail(makeRow({ status })).status).toBe(status)
    }

    const junk = mapMemoryItemRowToDetail(makeRow({ status: "nonsense" as MemoryStatus }))
    expect(junk.status).toBe("active")
  })
})
