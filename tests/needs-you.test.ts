import { describe, expect, it } from "vitest"

import { buildNeedsYou } from "@/lib/needs-you"
import type { DailyPlanRiskItem, RiskDecision, Task } from "@/types"

const NOW = new Date("2026-06-17T12:00:00.000Z").getTime()
const HOUR = 60 * 60 * 1000

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    userId: "user-1",
    title: `Task ${overrides.id}`,
    description: null,
    deadline: null,
    durationMinutes: 60,
    priority: "medium",
    status: "todo",
    scheduledFor: null,
    isImmutable: false,
    allDay: false,
    calendarId: null,
    tags: [],
    sourceSnapshotId: null,
    sourceCandidateId: null,
    planId: null,
    externalTaskId: null,
    lastSyncedFrom: "local",
    ...overrides,
  }
}

function overdueRisk(taskId: string): DailyPlanRiskItem {
  return {
    title: "Overdue work",
    detail: `Task ${taskId} is past its deadline.`,
    severity: "high",
    riskType: "overdue",
    subjectKey: taskId,
    taskId,
  }
}

function decision(overrides: Partial<RiskDecision> & Pick<RiskDecision, "riskType" | "subjectKey">): RiskDecision {
  return {
    id: `dec-${overrides.subjectKey}`,
    taskId: null,
    dismissedUntil: null,
    archivedAt: null,
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    ...overrides,
  }
}

describe("buildNeedsYou", () => {
  it("surfaces a risk for a live task", () => {
    const { items } = buildNeedsYou({
      riskItems: [overdueRisk("t1")],
      tasks: [task({ id: "t1" })],
      decisions: [],
      now: NOW,
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ riskType: "overdue", subjectKey: "t1", title: "Overdue work" })
  })

  it("drops a task-scoped risk once its task is completed (no replan needed)", () => {
    const { items } = buildNeedsYou({
      riskItems: [overdueRisk("t1")],
      tasks: [task({ id: "t1", status: "completed" })],
      decisions: [],
      now: NOW,
    })

    expect(items).toHaveLength(0)
  })

  it("drops a task-scoped risk once its task aged out to missed, and archives the task", () => {
    const { items, archive } = buildNeedsYou({
      riskItems: [overdueRisk("t1")],
      tasks: [task({ id: "t1", status: "missed", deadline: "2026-06-01T00:00:00.000Z" })],
      decisions: [],
      now: NOW,
    })

    expect(items).toHaveLength(0)
    expect(archive).toHaveLength(1)
    expect(archive[0]).toMatchObject({ kind: "missed-task", taskId: "t1" })
  })

  it("drops an orphaned task-scoped risk when its task no longer exists", () => {
    const { items } = buildNeedsYou({
      riskItems: [overdueRisk("ghost")],
      tasks: [],
      decisions: [],
      now: NOW,
    })

    expect(items).toHaveLength(0)
  })

  it("hides a snoozed risk until the snooze expires, then lets it return", () => {
    const snoozed = buildNeedsYou({
      riskItems: [overdueRisk("t1")],
      tasks: [task({ id: "t1" })],
      decisions: [
        decision({
          riskType: "overdue",
          subjectKey: "t1",
          dismissedUntil: new Date(NOW + 2 * HOUR).toISOString(),
        }),
      ],
      now: NOW,
    })
    expect(snoozed.items).toHaveLength(0)

    const returned = buildNeedsYou({
      riskItems: [overdueRisk("t1")],
      tasks: [task({ id: "t1" })],
      decisions: [
        decision({
          riskType: "overdue",
          subjectKey: "t1",
          dismissedUntil: new Date(NOW - HOUR).toISOString(),
        }),
      ],
      now: NOW,
    })
    expect(returned.items).toHaveLength(1)
  })

  it("removes a dismissed risk from the rail and lists it in the (reversible) archive", () => {
    const { items, archive } = buildNeedsYou({
      riskItems: [overdueRisk("t1")],
      tasks: [task({ id: "t1", title: "Email the registrar" })],
      decisions: [
        decision({
          riskType: "overdue",
          subjectKey: "t1",
          taskId: "t1",
          archivedAt: new Date(NOW).toISOString(),
        }),
      ],
      now: NOW,
    })

    expect(items).toHaveLength(0)
    expect(archive).toContainEqual(
      expect.objectContaining({ kind: "dismissed-risk", riskType: "overdue", subjectKey: "t1", detail: "Email the registrar" }),
    )
  })

  it("keeps an aggregate risk that has no backing task", () => {
    const { items } = buildNeedsYou({
      riskItems: [
        {
          title: "Overloaded day",
          detail: "2026-06-20 has 10 hours already placed.",
          severity: "medium",
          riskType: "overloaded_day",
          subjectKey: "2026-06-20",
        },
      ],
      tasks: [],
      decisions: [],
      now: NOW,
    })

    expect(items).toHaveLength(1)
    expect(items[0].riskType).toBe("overloaded_day")
  })

  it("orders items by severity, high first", () => {
    const { items } = buildNeedsYou({
      riskItems: [
        { ...overdueRisk("low"), severity: "low", riskType: "deadline_no_block", subjectKey: "low" },
        { ...overdueRisk("high"), severity: "high" },
        {
          title: "Compression ahead",
          detail: "Heavy week.",
          severity: "medium",
          riskType: "compression",
          subjectKey: "2026-06-22",
        },
      ],
      tasks: [task({ id: "low" }), task({ id: "high" })],
      decisions: [],
      now: NOW,
    })

    expect(items.map((item) => item.severity)).toEqual(["high", "medium", "low"])
  })
})
