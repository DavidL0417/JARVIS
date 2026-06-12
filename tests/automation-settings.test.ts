import { describe, expect, it } from "vitest"

import { isAutomationPaused, type AutomationSettings } from "@/lib/supabase/automation-settings"

const now = new Date("2026-06-11T12:00:00.000Z")

function settings(overrides: Partial<AutomationSettings> = {}): AutomationSettings {
  return { paused: false, pausedUntil: null, pausedReason: null, ...overrides }
}

describe("isAutomationPaused", () => {
  it("is not paused when the flag is off", () => {
    expect(isAutomationPaused(settings({ paused: false }), now)).toBe(false)
  })

  it("is paused indefinitely when the flag is on with no expiry", () => {
    expect(isAutomationPaused(settings({ paused: true }), now)).toBe(true)
  })

  it("is paused when the flag is on and the expiry is still in the future", () => {
    expect(
      isAutomationPaused(settings({ paused: true, pausedUntil: "2026-06-11T18:00:00.000Z" }), now),
    ).toBe(true)
  })

  it("auto-expires when paused_until has elapsed (no cron needed)", () => {
    expect(
      isAutomationPaused(settings({ paused: true, pausedUntil: "2026-06-11T06:00:00.000Z" }), now),
    ).toBe(false)
  })

  it("treats the exact expiry instant as elapsed", () => {
    expect(
      isAutomationPaused(settings({ paused: true, pausedUntil: now.toISOString() }), now),
    ).toBe(false)
  })
})
