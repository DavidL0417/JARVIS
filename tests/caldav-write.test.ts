import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { fetchCalendarsMock, createCalendarObjectMock, loginMock, integrationMock, tzMock, markStatusMock } = vi.hoisted(
  () => ({
    fetchCalendarsMock: vi.fn(),
    createCalendarObjectMock: vi.fn(),
    loginMock: vi.fn(),
    integrationMock: vi.fn(),
    tzMock: vi.fn(),
    markStatusMock: vi.fn(),
  }),
)

vi.mock("tsdav", () => ({
  DAVClient: class {
    login = loginMock
    fetchCalendars = fetchCalendarsMock
    createCalendarObject = createCalendarObjectMock
  },
}))

vi.mock("@/lib/supabase/caldav-integration", () => ({
  getStoredCalDavIntegration: integrationMock,
  markCalDavIntegrationStatus: markStatusMock,
  updateCalDavLastSyncedAt: vi.fn(),
}))

vi.mock("@/lib/data/user-timezone", () => ({ loadUserTimezone: tzMock }))

const { createCalDavEventForUser } = await import("../lib/caldav/write")

function okResponse(etag = '"e1"') {
  return { ok: true, status: 201, headers: { get: (k: string) => (k === "etag" ? etag : null) }, text: async () => "" } as unknown as Response
}
function errResponse(status: number, body = "") {
  return { ok: false, status, headers: { get: () => null }, text: async () => body } as unknown as Response
}

const HOME = { url: "https://caldav.icloud.com/1/calendars/home/", displayName: "Home", components: ["VEVENT"] }
const WORK = { url: "https://caldav.icloud.com/1/calendars/work/", displayName: "Work", components: ["VEVENT"] }
const REMINDERS = { url: "https://caldav.icloud.com/1/calendars/tasks/", displayName: "Reminders", components: ["VTODO"] }

const timed = { title: "Dentist", startIso: "2026-06-28T20:00:00.000Z", endIso: "2026-06-28T21:00:00.000Z" }

beforeEach(() => {
  integrationMock.mockResolvedValue({
    provider_account_email: "me@icloud.com",
    server_url: "https://caldav.icloud.com",
    password: "app-specific-pw",
  })
  tzMock.mockResolvedValue("America/Chicago")
  loginMock.mockResolvedValue(undefined)
  markStatusMock.mockResolvedValue(undefined)
})

afterEach(() => vi.clearAllMocks())

function lastIcs() {
  const call = createCalendarObjectMock.mock.calls.at(-1)?.[0] as { calendar: { url: string }; iCalString: string; filename: string }
  return call
}

describe("createCalDavEventForUser", () => {
  it("returns connected:false when CalDAV is not configured", async () => {
    integrationMock.mockResolvedValue(null)
    const result = await createCalDavEventForUser("u1", timed)
    expect(result).toMatchObject({ connected: false, created: false })
    expect(createCalendarObjectMock).not.toHaveBeenCalled()
  })

  it("writes to the first writable calendar by default and skips VTODO lists", async () => {
    fetchCalendarsMock.mockResolvedValue([REMINDERS, HOME, WORK])
    createCalendarObjectMock.mockResolvedValue(okResponse())
    const result = await createCalDavEventForUser("u1", timed)
    expect(result).toMatchObject({ connected: true, created: true, calendarSummary: "Home" })
    const call = lastIcs()
    expect(call.calendar.url).toBe(HOME.url) // not the VTODO reminders list
    expect(call.iCalString).toContain("DTSTART:20260628T200000Z")
    expect(call.filename.endsWith(".ics")).toBe(true)
  })

  it("resolves a named calendar case-insensitively", async () => {
    fetchCalendarsMock.mockResolvedValue([HOME, WORK])
    createCalendarObjectMock.mockResolvedValue(okResponse())
    const result = await createCalDavEventForUser("u1", { ...timed, calendarName: "work" })
    expect(result).toMatchObject({ created: true, calendarSummary: "Work" })
    expect(lastIcs().calendar.url).toBe(WORK.url)
  })

  it("errors with the writable calendar list when the named one is missing", async () => {
    fetchCalendarsMock.mockResolvedValue([HOME, WORK, REMINDERS])
    const result = await createCalDavEventForUser("u1", { ...timed, calendarName: "Nope" })
    expect(result.created).toBe(false)
    expect(result.error).toContain("Nope")
    expect(result.availableCalendars).toEqual(["Home", "Work"]) // VTODO list excluded
    expect(createCalendarObjectMock).not.toHaveBeenCalled()
  })

  it("regenerates the UID and retries once on a 412 collision", async () => {
    fetchCalendarsMock.mockResolvedValue([HOME])
    createCalendarObjectMock.mockResolvedValueOnce(errResponse(412)).mockResolvedValueOnce(okResponse())
    const result = await createCalDavEventForUser("u1", timed)
    expect(result.created).toBe(true)
    expect(createCalendarObjectMock).toHaveBeenCalledTimes(2)
    const first = createCalendarObjectMock.mock.calls[0][0] as { filename: string }
    const second = createCalendarObjectMock.mock.calls[1][0] as { filename: string }
    expect(first.filename).not.toBe(second.filename)
  })

  it("reports a 403 write rejection distinctly", async () => {
    fetchCalendarsMock.mockResolvedValue([HOME])
    createCalendarObjectMock.mockResolvedValue(errResponse(403))
    const result = await createCalDavEventForUser("u1", timed)
    expect(result.created).toBe(false)
    expect(result.error).toContain("403")
  })

  it("marks the integration needs_reauth on an auth failure", async () => {
    fetchCalendarsMock.mockRejectedValue(new Error("status 401 unauthorized"))
    const result = await createCalDavEventForUser("u1", timed)
    expect(result.created).toBe(false)
    expect(markStatusMock).toHaveBeenCalledWith({ userId: "u1", status: "needs_reauth" })
  })
})
