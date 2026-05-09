import { describe, expect, it } from "vitest"

import { USER_INTEGRATION_SELECT } from "../lib/data/mappers"
import { assistantMessageResponseSchema } from "../schemas/assistant"
import { dashboardResponseSchema } from "../schemas/dashboard"

const now = new Date("2026-05-05T12:00:00.000Z").toISOString()

describe("production response schemas", () => {
  it("accepts an honest empty dashboard payload", () => {
    expect(
      dashboardResponseSchema.parse({
        stats: {
          tasks: 0,
          overdue: 0,
          unscheduled: 0,
          checkInMode: "silent",
          memories: 0,
          sources: 0,
        },
        currentTask: null,
        tasks: [],
        events: [],
        memories: [],
        integrations: [],
        sourceConnectors: [
          {
            id: "notion",
            status: "missing_config",
            detail: "Notion OAuth is not configured for this app. Add NOTION_CLIENT_ID and NOTION_CLIENT_SECRET on the server before users can connect a workspace.",
            account: null,
            canRun: false,
            selectedSourceId: null,
            selectedSourceName: null,
          },
          {
            id: "gmail",
            status: "auth_needed",
            detail: "Authorize Google with Gmail read-only access before scanning mail.",
            account: null,
            canRun: false,
            selectedSourceId: null,
            selectedSourceName: null,
          },
        ],
        sources: [],
        sourceFiles: [],
        sourceCandidates: [],
        dailyPlan: null,
      }),
    ).toMatchObject({
      stats: {
        tasks: 0,
        memories: 0,
      },
    })
  })

  it("requires source snapshots in assistant context", () => {
    expect(
      assistantMessageResponseSchema.parse({
        ok: true,
        reply: "Ready.",
        toolCalls: [],
        needsRefresh: false,
        clarification: null,
        context: {
          availability: {
            timezone: "America/Chicago",
            workdayStart: "09:00",
            workdayEnd: "17:00",
            peakEnergyWindow: null,
            sleepPattern: null,
            procrastinationPattern: null,
            preferredCheckInMode: "quiet",
            defaultTaskDurationMinutes: 50,
            breakDurationMinutes: 10,
            preferredFocusBlockMinutes: null,
            availabilitySummary: "Ready.",
          },
          availabilityWindows: [],
          memoryEntries: [],
          sourceSnapshots: [
            {
              id: "00000000-0000-4000-8000-000000000001",
              source: "system",
              freshness: "fresh",
              summary: "Schema test.",
              capturedAt: now,
            },
          ],
          memorySummary: "No saved memory notes yet.",
        },
      }),
    ).toMatchObject({
      context: {
        sourceSnapshots: [
          {
            source: "system",
          },
        ],
      },
    })
  })

  it("keeps new integration source fields off the critical dashboard select", () => {
    expect(USER_INTEGRATION_SELECT).not.toContain("selected_source_id")
    expect(USER_INTEGRATION_SELECT).not.toContain("selected_source_name")
  })
})
