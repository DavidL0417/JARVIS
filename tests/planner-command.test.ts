import { describe, expect, it } from "vitest"

import { buildSchedulePromptPayloadForTest } from "../lib/ai/openai"
import type { SchedulePreparationContext } from "../types"

const userId = "00000000-0000-4000-8000-000000000001"

function makeContext(command: string): SchedulePreparationContext {
  return {
    userId,
    command,
    layeredContextMarkdown: "# Layered Context\n\n- Protect tonight.",
    sourceStatus: [
      {
        label: "Google Calendar",
        status: "fresh",
        detail: "Imported calendar events.",
      },
    ],
    plannerTradeoffContext: ["User explicitly asked for a lighter evening."],
    tasks: [
      {
        id: "00000000-0000-4000-8000-000000000002",
        userId,
        title: "Finish entrepreneurship memo",
        description: null,
        deadline: null,
        durationMinutes: 50,
        priority: "high",
        status: "todo",
        scheduledFor: null,
        isImmutable: false,
        allDay: false,
        calendarId: null,
        tags: [],
        sourceSnapshotId: null,
        sourceCandidateId: null,
        planId: null,
      },
    ],
    preferences: {
      userId,
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
    },
    hardEvents: [],
  }
}

describe("planner prompt payload", () => {
  it("passes natural-language commands and layered context into scheduling", () => {
    const payload = buildSchedulePromptPayloadForTest(makeContext("make today lighter and protect tonight"))

    expect(payload).toMatchObject({
      command: "make today lighter and protect tonight",
      memoryMarkdown: "# Layered Context\n\n- Protect tonight.",
      plannerTradeoffContext: ["User explicitly asked for a lighter evening."],
      sourceStatus: [
        {
          label: "Google Calendar",
          status: "fresh",
          detail: "Imported calendar events.",
        },
      ],
    })
  })
})
