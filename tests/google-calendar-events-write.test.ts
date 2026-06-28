import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Control the Google token, the user's timezone, and the network so we can exercise
// createGoogleCalendarEventForUser's resolution + POST body without real I/O.
const { tokenMock, tzMock } = vi.hoisted(() => ({ tokenMock: vi.fn(), tzMock: vi.fn() }))

vi.mock("@/lib/supabase/google-calendar-integration", () => ({
  getValidGoogleAccessToken: tokenMock,
  getStoredGoogleIntegration: vi.fn(),
  markGoogleIntegrationStatus: vi.fn(),
  updateGoogleLastSyncedAt: vi.fn(),
}))

vi.mock("@/lib/data/user-timezone", () => ({
  loadUserTimezone: tzMock,
}))

const { createGoogleCalendarEventForUser } = await import("../lib/google-calendar-events")

function res(data: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => data, text: async () => (ok ? "" : JSON.stringify(data)) } as unknown as Response
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  tokenMock.mockResolvedValue("access-token")
  tzMock.mockResolvedValue("America/Chicago")
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

function lastPostBody() {
  const call = fetchMock.mock.calls.find(([url, init]) => typeof url === "string" && (init as RequestInit)?.method === "POST")
  return { url: call?.[0] as string, body: JSON.parse((call?.[1] as RequestInit).body as string) }
}

describe("createGoogleCalendarEventForUser", () => {
  it("returns connected:false when Google is not authorized", async () => {
    tokenMock.mockResolvedValue(null)
    const result = await createGoogleCalendarEventForUser("u1", {
      title: "Dinner",
      startIso: "2026-06-28T01:00:00.000Z",
      endIso: "2026-06-28T02:00:00.000Z",
    })
    expect(result).toMatchObject({ connected: false, created: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("writes a timed event to the primary calendar by default", async () => {
    fetchMock.mockResolvedValue(res({ id: "evt_1", htmlLink: "https://cal/evt_1" }))
    const result = await createGoogleCalendarEventForUser("u1", {
      title: "Dinner",
      startIso: "2026-06-28T01:00:00.000Z",
      endIso: "2026-06-28T02:00:00.000Z",
    })
    expect(result).toMatchObject({ connected: true, created: true, eventId: "evt_1", calendarSummary: "your primary calendar" })
    const { url, body } = lastPostBody()
    expect(url).toContain("/calendars/primary/events")
    expect(body.start).toEqual({ dateTime: "2026-06-28T01:00:00.000Z" })
    expect(body.end).toEqual({ dateTime: "2026-06-28T02:00:00.000Z" })
    expect(body.extendedProperties.private.source).toBe("jarvis_assistant")
  })

  it("resolves a named calendar case-insensitively to its id", async () => {
    fetchMock
      .mockResolvedValueOnce(res({ items: [{ id: "cal_ap", summary: "Appointments Personal", accessRole: "owner" }] }))
      .mockResolvedValueOnce(res({ id: "evt_2" }))
    const result = await createGoogleCalendarEventForUser("u1", {
      title: "Haircut",
      startIso: "2026-06-28T20:00:00.000Z",
      endIso: "2026-06-28T21:00:00.000Z",
      calendarName: "appointments personal",
    })
    expect(result).toMatchObject({ created: true, calendarSummary: "Appointments Personal" })
    expect(lastPostBody().url).toContain("/calendars/cal_ap/events")
  })

  it("errors with the writable calendar list when the named calendar is missing", async () => {
    fetchMock.mockResolvedValueOnce(
      res({
        items: [
          { id: "p", summary: "Personal", accessRole: "owner", primary: true },
          { id: "h", summary: "US Holidays", accessRole: "reader" },
        ],
      }),
    )
    const result = await createGoogleCalendarEventForUser("u1", {
      title: "X",
      startIso: "2026-06-28T20:00:00.000Z",
      endIso: "2026-06-28T21:00:00.000Z",
      calendarName: "Nonexistent",
    })
    expect(result.created).toBe(false)
    expect(result.error).toContain("Nonexistent")
    // Read-only calendars are excluded from the "you can use" list.
    expect(result.availableCalendars).toEqual(["Personal"])
  })

  it("rejects a read-only target calendar", async () => {
    fetchMock.mockResolvedValueOnce(res({ items: [{ id: "h", summary: "US Holidays", accessRole: "reader" }] }))
    const result = await createGoogleCalendarEventForUser("u1", {
      title: "X",
      startIso: "2026-06-28T20:00:00.000Z",
      endIso: "2026-06-28T21:00:00.000Z",
      calendarName: "US Holidays",
    })
    expect(result.created).toBe(false)
    expect(result.error).toContain("read-only")
  })

  it("derives all-day dates in the user's timezone with an exclusive end (no UTC off-by-one)", async () => {
    fetchMock.mockResolvedValue(res({ id: "evt_3" }))
    // 01:00Z is the evening BEFORE in America/Chicago — local date is 2026-06-27.
    const result = await createGoogleCalendarEventForUser("u1", {
      title: "Conference",
      startIso: "2026-06-28T01:00:00.000Z",
      endIso: "2026-06-28T01:00:00.000Z",
      allDay: true,
    })
    expect(result.created).toBe(true)
    const { body } = lastPostBody()
    // Local date, not the naive UTC slice ("2026-06-28").
    expect(body.start).toEqual({ date: "2026-06-27" })
    // Google all-day end.date is exclusive: the day after the last day.
    expect(body.end).toEqual({ date: "2026-06-28" })
  })

  it("surfaces a Google API failure as an error result", async () => {
    fetchMock.mockResolvedValue(res({ error: "boom" }, false, 400))
    const result = await createGoogleCalendarEventForUser("u1", {
      title: "X",
      startIso: "2026-06-28T20:00:00.000Z",
      endIso: "2026-06-28T21:00:00.000Z",
    })
    expect(result.created).toBe(false)
    expect(result.connected).toBe(true)
  })

  it("errors when Google returns no event id", async () => {
    fetchMock.mockResolvedValue(res({}))
    const result = await createGoogleCalendarEventForUser("u1", {
      title: "X",
      startIso: "2026-06-28T20:00:00.000Z",
      endIso: "2026-06-28T21:00:00.000Z",
    })
    expect(result.created).toBe(false)
    expect(result.error).toContain("no event id")
  })
})
