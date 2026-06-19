import { afterEach, describe, expect, it, vi } from "vitest"

import { reconcileStaleSchedule } from "@/lib/reconciliation"
import { getAutomationSettings } from "@/lib/supabase/automation-settings"

// Keep the real isAutomationPaused (pure), stub only the DB-backed settings read.
vi.mock("@/lib/supabase/automation-settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/automation-settings")>()
  return { ...actual, getAutomationSettings: vi.fn() }
})

// A chainable, thenable Supabase-shaped stub: every method returns itself, and
// awaiting anywhere resolves to `result`.
function makeChain(result: unknown) {
  const chain: unknown = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(result)
      return () => chain
    },
    apply: () => chain,
  })
  return chain
}

const NOW = new Date("2026-06-18T12:00:00.000Z")

describe("reconcileStaleSchedule — pause gate", () => {
  afterEach(() => vi.clearAllMocks())

  it("does no work and touches no tables when automation is paused", async () => {
    vi.mocked(getAutomationSettings).mockResolvedValue({ paused: true, pausedUntil: null, pausedReason: null })
    const from = vi.fn()
    const adminClient = { from }

    const recap = await reconcileStaleSchedule(adminClient as never, "user-1", NOW)

    expect(recap.changed).toBe(false)
    expect(recap.unconfirmedCount).toBe(0)
    expect(recap.tasksReturnedToTodo).toBe(0)
    // The critical assertion: a paused user's dashboard load mutates nothing.
    expect(from).not.toHaveBeenCalled()
  })

  it("proceeds with reconciliation when automation is not paused", async () => {
    vi.mocked(getAutomationSettings).mockResolvedValue({ paused: false, pausedUntil: null, pausedReason: null })
    const from = vi.fn(() => makeChain({ data: [], error: null, count: 0 }))
    const adminClient = { from }

    const recap = await reconcileStaleSchedule(adminClient as never, "user-1", NOW)

    expect(from).toHaveBeenCalled()
    expect(recap.changed).toBe(false) // nothing stale in the stub, but the gate let it run
  })

  it("treats an expired pause as not paused", async () => {
    vi.mocked(getAutomationSettings).mockResolvedValue({
      paused: true,
      pausedUntil: "2026-06-18T00:00:00.000Z", // already elapsed at NOW
      pausedReason: null,
    })
    const from = vi.fn(() => makeChain({ data: [], error: null, count: 0 }))
    const adminClient = { from }

    await reconcileStaleSchedule(adminClient as never, "user-1", NOW)

    expect(from).toHaveBeenCalled()
  })
})
