import { afterEach, describe, expect, it, vi } from "vitest"

import {
  buildSchedulePromptPayloadForTest,
  buildScheduleResultFromPlannerPlanForTest,
} from "../lib/ai/claude"
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
      plannerHorizonDays: 28,
    },
    hardEvents: [],
  }
}

describe("planner prompt payload", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

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

  it("renders fixed commitments as blocked intervals", () => {
    const context = makeContext("schedule around fixed commitments")
    context.tasks.push({
      id: "00000000-0000-4000-8000-000000000003",
      userId,
      title: "Uncommon Hacks 2026 Hackathon",
      description: null,
      deadline: null,
      durationMinutes: 120,
      priority: "medium",
      status: "scheduled",
      scheduledFor: "2026-05-18T14:00:00.000Z",
      isImmutable: true,
      allDay: false,
      calendarId: "cal-commitments",
      tags: [],
      sourceSnapshotId: null,
      sourceCandidateId: null,
      planId: null,
    })

    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-16T15:00:00.000Z"))

    const payload = buildSchedulePromptPayloadForTest(context)

    expect(payload.blockedIntervals).toContainEqual({
      start: "2026-05-18T14:00:00.000Z",
      end: "2026-05-18T16:00:00.000Z",
      label: "fixed-task:Uncommon Hacks 2026 Hackathon",
    })
  })

  it("leaves illegal model placements unscheduled instead of failing the whole plan", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-16T15:00:00.000Z"))

    const context = makeContext("apply weekly MLM spacing")
    const mlmTaskId = "00000000-0000-4000-8000-000000000004"
    context.tasks = [
      {
        id: "00000000-0000-4000-8000-000000000003",
        userId,
        title: "Uncommon Hacks 2026 Hackathon",
        description: null,
        deadline: null,
        durationMinutes: 120,
        priority: "medium",
        status: "scheduled",
        scheduledFor: "2026-05-18T14:00:00.000Z",
        isImmutable: true,
        allDay: false,
        calendarId: "cal-commitments",
        tags: [],
        sourceSnapshotId: null,
        sourceCandidateId: null,
        planId: null,
      },
      {
        id: mlmTaskId,
        userId,
        title: "Week 7 MLM Problems",
        description: null,
        deadline: null,
        durationMinutes: 240,
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
    ]

    const result = buildScheduleResultFromPlannerPlanForTest(context, {
      placements: [
        {
          taskId: mlmTaskId,
          start: "2026-05-18T14:30:00.000Z",
          end: "2026-05-18T18:30:00.000Z",
        },
      ],
      unscheduledTaskIds: [],
      summary: "Built a plan around the new MLM preference.",
      tradeoffNotes: [],
    })

    expect(result.proposedEvents.map((event) => event.taskId)).not.toContain(mlmTaskId)
    expect(result.unscheduledTaskIds).toContain(mlmTaskId)
    expect(result.summary).toContain("left 1 invalid planner placement unscheduled")
    expect(result.tradeoffNotes).toContain(
      "Planner left Week 7 MLM Problems unscheduled because it overlapped fixed-task:Uncommon Hacks 2026 Hackathon.",
    )
  })
})
