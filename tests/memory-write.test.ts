import { describe, expect, it } from "vitest"

import {
  insertMemoryItem,
  isMemoryDuplicateError,
  POSTGRES_UNIQUE_VIOLATION,
  unexpiredOrFilter,
} from "../lib/assistant/memory-write"

type MaybeSingleResult = {
  data?: { id: string } | null
  error?: { code?: string; message: string } | null
}

// Minimal stub of the supabase query chain insertMemoryItem walks:
// client.from(...).insert(...).select(...).maybeSingle()
function stubClient(result: MaybeSingleResult) {
  return {
    from() {
      return {
        insert() {
          return {
            select() {
              return {
                maybeSingle: async () => ({
                  data: result.data ?? null,
                  error: result.error ?? null,
                }),
              }
            },
          }
        },
      }
    },
  } as unknown as Parameters<typeof insertMemoryItem>[0]
}

describe("isMemoryDuplicateError", () => {
  it("matches the Postgres unique_violation code only", () => {
    expect(isMemoryDuplicateError({ code: POSTGRES_UNIQUE_VIOLATION })).toBe(true)
    expect(isMemoryDuplicateError({ code: "23503" })).toBe(false)
    expect(isMemoryDuplicateError(null)).toBe(false)
    expect(isMemoryDuplicateError(undefined)).toBe(false)
  })
})

describe("unexpiredOrFilter", () => {
  it("builds a PostgREST or-filter for null-or-future expiry", () => {
    expect(unexpiredOrFilter("2026-06-15T00:00:00.000Z")).toBe(
      "expires_at.is.null,expires_at.gt.2026-06-15T00:00:00.000Z",
    )
  })
})

describe("insertMemoryItem", () => {
  it("returns the inserted id on success", async () => {
    const outcome = await insertMemoryItem(stubClient({ data: { id: "mem-1" } }), {
      content: "play piano daily",
    })
    expect(outcome).toEqual({ id: "mem-1", deduped: false })
  })

  it("treats a unique violation as an idempotent no-op", async () => {
    const outcome = await insertMemoryItem(
      stubClient({ error: { code: POSTGRES_UNIQUE_VIOLATION, message: "duplicate key value" } }),
      { content: "play piano daily" },
    )
    expect(outcome).toEqual({ id: null, deduped: true })
  })

  it("re-throws non-duplicate database errors", async () => {
    await expect(
      insertMemoryItem(stubClient({ error: { code: "23503", message: "fk violation" } }), {
        content: "play piano daily",
      }),
    ).rejects.toThrow("fk violation")
  })
})
