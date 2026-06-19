import { describe, expect, it } from "vitest"

import {
  type FilterRule,
  type FilterState,
  type SortRule,
  evaluateFilter,
  evaluateRule,
  makeSortComparator,
} from "@/lib/task-filter"
import type { Task } from "@/types"

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date("2026-06-18T12:00:00").getTime()

function task(over: Partial<Task> & { id: string }): Task {
  return {
    userId: "u1",
    title: `Task ${over.id}`,
    description: null,
    deadline: null,
    durationMinutes: null,
    priority: "medium",
    status: "todo",
    scheduledFor: null,
    isImmutable: false,
    allDay: false,
    calendarId: null,
    tags: [],
    course: null,
    category: null,
    sourceSnapshotId: null,
    sourceCandidateId: null,
    planId: null,
    externalTaskId: null,
    lastSyncedFrom: "local",
    inferredDeadline: null,
    inferredDeadlineReason: null,
    inferredDeadlineDismissed: false,
    ...over,
  }
}

const rule = (over: Partial<FilterRule> & { property: FilterRule["property"]; operator: string }): FilterRule => ({
  id: over.id ?? "r1",
  value: {},
  ...over,
})

describe("evaluateRule — text", () => {
  const t = task({ id: "1", title: "Week 6 MLM Problems", course: "MATH 240 — Linear Algebra" })

  it("contains is case-insensitive and substring", () => {
    expect(evaluateRule(rule({ property: "course", operator: "contains", value: { text: "math" } }), t, NOW)).toBe(true)
    expect(evaluateRule(rule({ property: "course", operator: "contains", value: { text: "chem" } }), t, NOW)).toBe(false)
  })

  it("does not contain, is, is empty", () => {
    expect(evaluateRule(rule({ property: "name", operator: "not_contains", value: { text: "exam" } }), t, NOW)).toBe(true)
    expect(evaluateRule(rule({ property: "course", operator: "is_empty", value: {} }), t, NOW)).toBe(false)
    expect(evaluateRule(rule({ property: "course", operator: "is_empty", value: {} }), task({ id: "2" }), NOW)).toBe(true)
  })
})

describe("evaluateRule — select", () => {
  const reading = task({ id: "1", category: "Reading", priority: "high" })

  it("is any of / is none of", () => {
    expect(
      evaluateRule(rule({ property: "category", operator: "is_any_of", value: { values: ["Reading", "Problem Set"] } }), reading, NOW),
    ).toBe(true)
    expect(
      evaluateRule(rule({ property: "category", operator: "is_none_of", value: { values: ["Reading"] } }), reading, NOW),
    ).toBe(false)
  })

  it("priority select reads the title-cased label", () => {
    expect(evaluateRule(rule({ property: "priority", operator: "is_any_of", value: { values: ["High"] } }), reading, NOW)).toBe(true)
    expect(evaluateRule(rule({ property: "priority", operator: "is_any_of", value: { values: ["Low"] } }), reading, NOW)).toBe(false)
  })

  it("empty is_any_of imposes no constraint", () => {
    expect(evaluateRule(rule({ property: "category", operator: "is_any_of", value: { values: [] } }), reading, NOW)).toBe(true)
  })
})

describe("evaluateRule — date", () => {
  const overdue = task({ id: "1", deadline: new Date(NOW - 2 * DAY).toISOString() })
  const soon = task({ id: "2", deadline: new Date(NOW + 2 * DAY).toISOString() })
  const undated = task({ id: "3", deadline: null })

  it("relative overdue / future", () => {
    expect(evaluateRule(rule({ property: "due", operator: "relative", value: { preset: "overdue" } }), overdue, NOW)).toBe(true)
    expect(evaluateRule(rule({ property: "due", operator: "relative", value: { preset: "overdue" } }), soon, NOW)).toBe(false)
    expect(evaluateRule(rule({ property: "due", operator: "relative", value: { preset: "future" } }), soon, NOW)).toBe(true)
  })

  it("before / after a picked day", () => {
    expect(evaluateRule(rule({ property: "due", operator: "before", value: { date: "2026-06-25" } }), overdue, NOW)).toBe(true)
    expect(evaluateRule(rule({ property: "due", operator: "after", value: { date: "2026-06-25" } }), overdue, NOW)).toBe(false)
  })

  it("is empty / and excludes undated from positive constraints", () => {
    expect(evaluateRule(rule({ property: "due", operator: "is_empty", value: {} }), undated, NOW)).toBe(true)
    expect(evaluateRule(rule({ property: "due", operator: "relative", value: { preset: "overdue" } }), undated, NOW)).toBe(false)
  })
})

describe("evaluateFilter — conjunction", () => {
  const t = task({ id: "1", course: "MATH 240", category: "Problem Set" })
  const rules: FilterRule[] = [
    rule({ id: "a", property: "course", operator: "contains", value: { text: "math" } }),
    rule({ id: "b", property: "category", operator: "is_any_of", value: { values: ["Reading"] } }),
  ]

  it("AND requires all rules; OR requires any", () => {
    expect(evaluateFilter({ conjunction: "and", rules } as FilterState, t, NOW)).toBe(false)
    expect(evaluateFilter({ conjunction: "or", rules } as FilterState, t, NOW)).toBe(true)
  })

  it("no rules → everything passes", () => {
    expect(evaluateFilter({ conjunction: "and", rules: [] }, t, NOW)).toBe(true)
  })
})

describe("makeSortComparator", () => {
  it("sinks finished work below active, regardless of sort key", () => {
    const done = task({ id: "done", status: "completed", title: "AAA" })
    const open = task({ id: "open", status: "todo", title: "ZZZ" })
    const sorted = [done, open].sort(makeSortComparator([{ id: "s", key: "name", direction: "asc" }], NOW))
    expect(sorted.map((t) => t.id)).toEqual(["open", "done"])
  })

  it("applies multiple keys in order with direction", () => {
    const a = task({ id: "a", priority: "high", title: "B" })
    const b = task({ id: "b", priority: "high", title: "A" })
    const c = task({ id: "c", priority: "low", title: "C" })
    const sorts: SortRule[] = [
      { id: "1", key: "priority", direction: "asc" },
      { id: "2", key: "name", direction: "asc" },
    ]
    const sorted = [a, b, c].sort(makeSortComparator(sorts, NOW))
    expect(sorted.map((t) => t.id)).toEqual(["b", "a", "c"])
  })

  it("respects descending direction", () => {
    const a = task({ id: "a", title: "A" })
    const z = task({ id: "z", title: "Z" })
    const sorted = [a, z].sort(makeSortComparator([{ id: "s", key: "name", direction: "desc" }], NOW))
    expect(sorted.map((t) => t.id)).toEqual(["z", "a"])
  })
})
