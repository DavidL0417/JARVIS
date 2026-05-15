import { afterEach, describe, expect, it, vi } from "vitest"

import { generateSecretaryDialogueReply } from "../lib/assistant/dialogue"
import type { AssistantRuntimeContext } from "../lib/assistant/context"

const runtime = {
  userId: "user-1",
  preferences: null,
  preferencesRow: null,
  tasks: [],
  events: [],
  memoryEntries: [],
  sourceSnapshots: [],
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
      availabilitySummary: "No availability loaded.",
    },
    availabilityWindows: [],
    memoryEntries: [],
    sourceSnapshots: [],
    memorySummary: "No memory loaded.",
  },
} as unknown as AssistantRuntimeContext

describe("secretary dialogue", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("fails clearly when Claude is not configured instead of using a local dialogue fallback", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "")

    const result = await generateSecretaryDialogueReply({
      message: "How are you?",
      history: [],
      now: "2026-05-06T16:00:00.000Z",
      timezone: "America/Chicago",
      runtime,
    })

    expect(result.ok).toBe(false)
    expect(result.reply).toBe("The secretary model is not configured.")
    expect(result.error).toContain("ANTHROPIC_API_KEY")
    expect(result.reply).not.toContain("schedule, tasks, and memory in front of me")
  })
})
