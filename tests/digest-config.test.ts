import { describe, expect, it } from "vitest"

import { DIGEST_DEFAULTS, resolveDigestConfig } from "@/lib/digest/config"
import type { UserPreferences } from "@/types"

function preferences(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return {
    userId: "00000000-0000-0000-0000-000000000000",
    timezone: "America/Chicago",
    sleepPattern: null,
    peakEnergyWindow: null,
    procrastinationPattern: null,
    workdayStart: "09:00",
    workdayEnd: "17:00",
    defaultTaskDurationMinutes: 50,
    breakDurationMinutes: 10,
    preferredFocusBlockMinutes: null,
    preferredCheckInMode: "quiet",
    calendarId: null,
    plannerHorizonDays: 28,
    morningDigestEnabled: true,
    eveningDigestEnabled: true,
    morningDigestTime: "08:30",
    eveningDigestTime: "18:30",
    quietHoursStart: null,
    quietHoursEnd: null,
    ...overrides,
  }
}

describe("resolveDigestConfig", () => {
  it("falls back to the system defaults when there is no preferences row", () => {
    expect(resolveDigestConfig(null)).toEqual(DIGEST_DEFAULTS)
  })

  it("carries per-user enable flags, send times, and quiet hours through", () => {
    const config = resolveDigestConfig(
      preferences({
        morningDigestEnabled: false,
        eveningDigestEnabled: true,
        morningDigestTime: "07:15",
        eveningDigestTime: "20:45",
        quietHoursStart: "22:00",
        quietHoursEnd: "07:00",
      }),
    )
    expect(config).toEqual({
      morningEnabled: false,
      eveningEnabled: true,
      morningTime: "07:15",
      eveningTime: "20:45",
      maxCatchupMinutes: DIGEST_DEFAULTS.maxCatchupMinutes,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
    })
  })

  it("keeps maxCatchupMinutes a system constant, not user-configurable", () => {
    const config = resolveDigestConfig(preferences({ morningDigestTime: "06:00" }))
    expect(config.maxCatchupMinutes).toBe(DIGEST_DEFAULTS.maxCatchupMinutes)
  })

  it("preserves a disabled morning flag (does not coalesce false to the default true)", () => {
    expect(resolveDigestConfig(preferences({ morningDigestEnabled: false })).morningEnabled).toBe(false)
  })
})
