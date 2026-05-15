import { afterEach, describe, expect, it, vi } from "vitest"

import { GOOGLE_CALENDAR_READONLY_SCOPE } from "../lib/google-oauth"
import {
  refreshSourcesForUser,
  SourceRefreshError,
} from "../lib/sources/refresh"
import { syncGoogleCalendarEventsForUser } from "@/lib/google-calendar-events"
import { getStoredGoogleIntegration } from "@/lib/supabase/google-calendar-integration"

vi.mock("@/lib/google-calendar-events", () => ({
  syncGoogleCalendarEventsForUser: vi.fn(),
}))

vi.mock("@/lib/supabase/google-calendar-integration", () => ({
  getStoredGoogleIntegration: vi.fn(),
}))

function makeAdminClient(notionConfig: unknown = null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: notionConfig,
              error: null,
            })),
          })),
        })),
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

    await expect(
      refreshSourcesForUser({
        userId: "00000000-0000-4000-8000-000000000001",
        mode: "pre_plan",
        adminClient: makeAdminClient(),
      }),
    ).resolves.toMatchObject({
      items: [
        { source: "google_calendar", status: "skipped", runnable: false },
        { source: "gmail", status: "skipped", runnable: false },
        { source: "notion", status: "skipped", runnable: false },
      ],
    })
  })
})
