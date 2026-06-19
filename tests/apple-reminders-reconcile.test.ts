import { afterEach, describe, expect, it, vi } from "vitest"

import { ingestAppleReminders, reminderExternalTaskId } from "@/lib/apple-reminders/ingest"
import { insertSourceSnapshot } from "@/lib/sources/persistence"

vi.mock("@/lib/sources/persistence", () => ({ insertSourceSnapshot: vi.fn() }))
vi.mock("@/lib/data/user-timezone", () => ({ loadUserTimezone: vi.fn(async () => null) }))

type ExistingRow = {
  id: string
  external_task_id: string
  status: string
  scheduled_for: string | null
  plan_id: string | null
  priority: string
  duration_minutes: number | null
}

function existingRow(id: string, ext: string): ExistingRow {
  return { id, external_task_id: ext, status: "todo", scheduled_for: null, plan_id: null, priority: "medium", duration_minutes: null }
}

// Minimal chained mock of the Supabase admin client, tracking destructive calls.
function makeAdminClient(existing: ExistingRow[]) {
  const calls = { deleteSchedule: 0, deleteTasks: 0, upsert: 0 }
  const adminClient = {
    from: vi.fn((table: string) => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({ data: existing, error: null }),
        }),
      }),
      upsert: async () => {
        calls.upsert++
        return { error: null }
      },
      delete: () => ({
        eq: () => ({
          in: async () => {
            if (table === "schedule_events") calls.deleteSchedule++
            else if (table === "tasks") calls.deleteTasks++
            return { error: null }
          },
        }),
      }),
    })),
  }
  return { adminClient: adminClient as never, calls }
}

describe("ingestAppleReminders — destructive-reconcile guard", () => {
  afterEach(() => vi.clearAllMocks())

  it("refuses to delete the mirror on an empty payload", async () => {
    const existing = [
      existingRow("t1", "apple-reminders:" + "a".repeat(32)),
      existingRow("t2", "apple-reminders:" + "b".repeat(32)),
    ]
    const { adminClient, calls } = makeAdminClient(existing)

    const result = await ingestAppleReminders(adminClient, "user-1", [])

    expect(result.removed).toBe(0)
    expect(calls.deleteTasks).toBe(0)
    expect(calls.deleteSchedule).toBe(0)
    expect(vi.mocked(insertSourceSnapshot)).toHaveBeenCalledWith(expect.objectContaining({ freshness: "partial" }))
  })

  it("skips the delete on a drastic drop (>50% loss of a large mirror)", async () => {
    const r1 = { title: "keep one", list: "Reminders" }
    const r2 = { title: "keep two", list: "Reminders" }
    const existing = [existingRow("t1", reminderExternalTaskId(r1)), existingRow("t2", reminderExternalTaskId(r2))]
    for (let i = 0; i < 8; i++) existing.push(existingRow(`x${i}`, `apple-reminders:stale${i}`))
    // existing = 10, incoming live = 2 → 2 < 50% of 10 → guard trips.
    const { adminClient, calls } = makeAdminClient(existing)

    const result = await ingestAppleReminders(adminClient, "user-1", [r1, r2])

    expect(result.removed).toBe(0)
    expect(calls.deleteTasks).toBe(0)
    expect(vi.mocked(insertSourceSnapshot)).toHaveBeenCalledWith(expect.objectContaining({ freshness: "partial" }))
  })

  it("reconciles normally for a small mirror with a genuine removal (guard does not over-block)", async () => {
    const keep = { title: "keep me", list: "Reminders" }
    const existing = [existingRow("t1", reminderExternalTaskId(keep)), existingRow("t2", "apple-reminders:gonenow")]
    // existing = 2 (< 8 min) → under-count guard inactive; payload non-empty → delete proceeds.
    const { adminClient, calls } = makeAdminClient(existing)

    const result = await ingestAppleReminders(adminClient, "user-1", [keep])

    expect(result.removed).toBe(1)
    expect(calls.deleteTasks).toBe(1)
    expect(calls.deleteSchedule).toBe(1)
    expect(vi.mocked(insertSourceSnapshot)).toHaveBeenCalledWith(expect.objectContaining({ freshness: "fresh" }))
  })
})
