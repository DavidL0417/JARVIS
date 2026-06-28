import { describe, expect, it } from "vitest"

import { executeAgentTool, type AgentExecContext } from "../lib/assistant/agent/executors"

// execCreateCalendarEvent is pure (it only resolves times and queues an approval —
// no DB or network), so we can drive it through executeAgentTool with a stub ctx.
const ctx: AgentExecContext = {
  supabase: {} as never,
  userId: "user-1",
  now: "2026-06-27T16:00:00.000Z",
  timezone: "America/Chicago",
  surface: "interactive",
  runtime: {} as never,
  command: "put dinner on my google calendar 8-9pm",
}

describe("create_calendar_event executor", () => {
  it("queues an approval carrying a resolved event payload", async () => {
    const outcome = await executeAgentTool(
      "create_calendar_event",
      {
        title: "Dinner",
        startIso: "2026-06-28T20:00:00-05:00",
        endIso: "2026-06-28T21:00:00-05:00",
        calendar: "Appointments Personal",
      },
      ctx,
    )

    expect(outcome.receipt.status).toBe("pending_approval")
    expect(outcome.receipt.requiresApproval).toBe(true)
    expect(outcome.didWrite).toBe(false)
    // The approve route reads payload.action — this is the contract.
    expect(outcome.payload).toMatchObject({
      action: "google_calendar_event_create",
      title: "Dinner",
      calendarName: "Appointments Personal",
      allDay: false,
    })
    // Natural/ISO times are resolved to concrete ISO before the user approves.
    expect(typeof outcome.payload?.startIso).toBe("string")
    expect(outcome.payload?.startIso).toBe("2026-06-29T01:00:00.000Z")
    expect(outcome.payload?.endIso).toBe("2026-06-29T02:00:00.000Z")
  })

  it("defaults to the primary calendar when none is named", async () => {
    const outcome = await executeAgentTool(
      "create_calendar_event",
      {
        title: "Dinner",
        startIso: "2026-06-28T20:00:00-05:00",
        endIso: "2026-06-28T21:00:00-05:00",
      },
      ctx,
    )

    expect(outcome.receipt.status).toBe("pending_approval")
    expect(outcome.payload).toMatchObject({ action: "google_calendar_event_create", calendarName: null })
  })

  it("errors without writing when the title is missing", async () => {
    const outcome = await executeAgentTool(
      "create_calendar_event",
      { startIso: "2026-06-28T20:00:00-05:00", endIso: "2026-06-28T21:00:00-05:00" },
      ctx,
    )

    expect(outcome.receipt.status).toBe("error")
    expect(outcome.didWrite).toBe(false)
    expect(outcome.payload).toBeUndefined()
  })

  it("errors on an unparseable time", async () => {
    const outcome = await executeAgentTool(
      "create_calendar_event",
      { title: "Dinner", startIso: "whenever", endIso: "later" },
      ctx,
    )

    expect(outcome.receipt.status).toBe("error")
    expect(outcome.didWrite).toBe(false)
  })

  it("rejects a timed event whose end is not after its start", async () => {
    const outcome = await executeAgentTool(
      "create_calendar_event",
      { title: "Dinner", startIso: "2026-06-28T21:00:00-05:00", endIso: "2026-06-28T20:00:00-05:00" },
      ctx,
    )

    expect(outcome.receipt.status).toBe("error")
    expect(outcome.payload).toBeUndefined()
  })

  it("queues an all-day event and allows a same-day start/end", async () => {
    const outcome = await executeAgentTool(
      "create_calendar_event",
      {
        title: "Conference",
        startIso: "2026-06-28T00:00:00-05:00",
        endIso: "2026-06-28T00:00:00-05:00",
        allDay: true,
      },
      ctx,
    )

    expect(outcome.receipt.status).toBe("pending_approval")
    expect(outcome.payload).toMatchObject({ action: "google_calendar_event_create", allDay: true })
  })

  it("is blocked on the read-only note surface", async () => {
    const outcome = await executeAgentTool(
      "create_calendar_event",
      {
        title: "Dinner",
        startIso: "2026-06-28T20:00:00-05:00",
        endIso: "2026-06-28T21:00:00-05:00",
      },
      { ...ctx, surface: "note" },
    )

    expect(outcome.receipt.status).toBe("error")
    expect(outcome.didWrite).toBe(false)
  })
})
