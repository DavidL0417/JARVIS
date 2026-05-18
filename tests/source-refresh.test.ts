import { afterEach, describe, expect, it, vi } from "vitest"

import { GOOGLE_CALENDAR_READONLY_SCOPE } from "../lib/google-oauth"
import {
  refreshSourcesForUser,
  SourceRefreshError,
} from "../lib/sources/refresh"
import { refreshCalDavForUser } from "@/lib/caldav/refresh"
import { syncGoogleCalendarEventsForUser } from "@/lib/google-calendar-events"
import { refreshCanvasForUser } from "@/lib/sources/canvas-refresh"
import { getStoredCanvasIntegration } from "@/lib/supabase/canvas-integration"
import { getStoredCalDavIntegration } from "@/lib/supabase/caldav-integration"
import { getStoredGoogleIntegration } from "@/lib/supabase/google-calendar-integration"

vi.mock("@/lib/google-calendar-events", () => ({
  syncGoogleCalendarEventsForUser: vi.fn(),
}))

vi.mock("@/lib/caldav/refresh", () => ({
  refreshCalDavForUser: vi.fn(),
}))

vi.mock("@/lib/sources/canvas-refresh", () => ({
  refreshCanvasForUser: vi.fn(),
}))

vi.mock("@/lib/supabase/canvas-integration", () => ({
  getStoredCanvasIntegration: vi.fn(),
}))

vi.mock("@/lib/supabase/caldav-integration", () => ({
  getStoredCalDavIntegration: vi.fn(),
}))

vi.mock("@/lib/supabase/google-calendar-integration", () => ({
  getStoredGoogleIntegration: vi.fn(),
}))

function makeAdminClient(notionConfig: unknown = null, connectorSettings: Array<{ connector_id: string; enabled: boolean }> = []) {
  return {
    from: vi.fn((table: string) => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: {
              id: "00000000-0000-4000-8000-000000000010",
              source: "canvas",
              freshness: "failed",
              summary: "Canvas failed.",
              captured_at: new Date().toISOString(),
            },
            error: null,
          })),
        })),
      })),
      select: vi.fn(() => ({
        eq: vi.fn(() => {
          if (table === "connector_settings") {
            return Promise.resolve({
              data: connectorSettings,
              error: null,
            })
          }

          return {
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: notionConfig,
                error: null,
              })),
            })),
          }
        }),
      })),
    })),
  } as never
}

describe("source refresh gate", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("fails pre-plan refresh when a connected runnable source fails", async () => {
    vi.mocked(getStoredGoogleIntegration).mockResolvedValue({
      provider_account_email: null,
      provider_user_id: null,
      status: "connected",
      selected_calendar_id: null,
      selected_source_id: null,
      selected_source_name: null,
      last_synced_at: null,
      access_token: null,
      refresh_token: null,
      expires_at: null,
      scope: GOOGLE_CALENDAR_READONLY_SCOPE,
    })
    vi.mocked(syncGoogleCalendarEventsForUser).mockResolvedValue({
      success: false,
      connected: false,
      needsAuthorization: false,
      events: [],
      calendars: [],
      error: "Calendar import failed.",
    })
    vi.mocked(getStoredCanvasIntegration).mockResolvedValue(null)
    vi.mocked(getStoredCalDavIntegration).mockResolvedValue(null)

    await expect(
      refreshSourcesForUser({
        userId: "00000000-0000-4000-8000-000000000001",
        mode: "pre_plan",
        adminClient: makeAdminClient(),
      }),
    ).rejects.toBeInstanceOf(SourceRefreshError)
  })

  it("treats unconnected sources as missing coverage instead of pre-plan failures", async () => {
    vi.mocked(getStoredGoogleIntegration).mockResolvedValue(null)
    vi.mocked(getStoredCanvasIntegration).mockResolvedValue(null)
    vi.mocked(getStoredCalDavIntegration).mockResolvedValue(null)

    await expect(
      refreshSourcesForUser({
        userId: "00000000-0000-4000-8000-000000000001",
        mode: "pre_plan",
        adminClient: makeAdminClient(),
      }),
    ).resolves.toMatchObject({
      items: [
        { source: "google_calendar", status: "skipped", runnable: false },
        { source: "caldav", status: "skipped", runnable: false },
        { source: "gmail", status: "skipped", runnable: false },
        { source: "notion", status: "skipped", runnable: false },
        { source: "canvas", status: "skipped", runnable: false },
      ],
    })
  })

  it("fails pre-plan refresh when connected Canvas refresh fails", async () => {
    vi.mocked(getStoredGoogleIntegration).mockResolvedValue(null)
    vi.mocked(getStoredCalDavIntegration).mockResolvedValue(null)
    vi.mocked(getStoredCanvasIntegration).mockResolvedValue({
      provider_account_email: null,
      provider_user_id: null,
      status: "connected",
      base_url: "https://canvas.example.edu",
      base_name: "canvas.example.edu",
      last_synced_at: null,
      access_token: "token",
    })
    vi.mocked(refreshCanvasForUser).mockRejectedValue(new Error("CANVAS_REAUTH_REQUIRED: Canvas rejected the access token."))

    await expect(
      refreshSourcesForUser({
        userId: "00000000-0000-4000-8000-000000000001",
        mode: "pre_plan",
        adminClient: makeAdminClient(),
      }),
    ).rejects.toBeInstanceOf(SourceRefreshError)
  })

  it("skips disabled connected sources without failing pre-plan refresh", async () => {
    vi.mocked(getStoredGoogleIntegration).mockResolvedValue({
      provider_account_email: null,
      provider_user_id: null,
      status: "connected",
      selected_calendar_id: null,
      selected_source_id: null,
      selected_source_name: null,
      last_synced_at: null,
      access_token: "token",
      refresh_token: null,
      expires_at: null,
      scope: GOOGLE_CALENDAR_READONLY_SCOPE,
    })
    vi.mocked(getStoredCanvasIntegration).mockResolvedValue(null)
    vi.mocked(getStoredCalDavIntegration).mockResolvedValue(null)

    const result = await refreshSourcesForUser({
      userId: "00000000-0000-4000-8000-000000000001",
      mode: "pre_plan",
      adminClient: makeAdminClient(null, [{ connector_id: "google_calendar", enabled: false }]),
    })

    expect(result.items[0]).toMatchObject({ source: "google_calendar", status: "skipped", runnable: false })
    expect(syncGoogleCalendarEventsForUser).not.toHaveBeenCalled()
  })

  it("fails pre-plan refresh when connected CalDAV refresh fails", async () => {
    vi.mocked(getStoredGoogleIntegration).mockResolvedValue(null)
    vi.mocked(getStoredCanvasIntegration).mockResolvedValue(null)
    vi.mocked(getStoredCalDavIntegration).mockResolvedValue({
      provider_account_email: "david@example.com",
      provider_user_id: "david@example.com",
      status: "connected",
      server_url: "https://caldav.example.com",
      server_name: "caldav.example.com",
      last_synced_at: null,
      password: "app-password",
    })
    vi.mocked(refreshCalDavForUser).mockResolvedValue({
      success: false,
      connected: false,
      needsAuthorization: true,
      events: [],
      calendars: [],
      error: "CalDAV rejected the app password.",
    })

    await expect(
      refreshSourcesForUser({
        userId: "00000000-0000-4000-8000-000000000001",
        mode: "pre_plan",
        adminClient: makeAdminClient(),
      }),
    ).rejects.toBeInstanceOf(SourceRefreshError)
  })
})
