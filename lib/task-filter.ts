// Notion-style filter + sort engine for the task pane. Pure and dependency-light
// so it runs on every keystroke and is unit-testable in isolation.
//
// A filter is a list of RULES combined by one conjunction (AND/OR). Each rule
// targets a PROPERTY (Name/Course/Category/Status/Source/Priority/Due date), picks
// an OPERATOR valid for that property's TYPE (text/select/date), and carries a
// value whose shape depends on the operator. Sort is a list of KEYS, each with a
// direction; finished work (completed/missed) always sinks below active work.

import type { Task } from "@/types"
import {
  TASK_STATUS_ORDER,
  compareByDeadline,
  priorityLabel,
  taskSourceLabel,
  taskStatusLabel,
} from "@/lib/task-display"

const DAY = 24 * 60 * 60 * 1000

export type PropertyType = "text" | "select" | "date"
export type FilterPropertyKey = "name" | "course" | "category" | "status" | "source" | "priority" | "due"

export type FilterProperty = { key: FilterPropertyKey; label: string; type: PropertyType }

export const FILTER_PROPERTIES: FilterProperty[] = [
  { key: "name", label: "Name", type: "text" },
  { key: "course", label: "Course", type: "text" },
  { key: "category", label: "Category", type: "select" },
  { key: "status", label: "Status", type: "select" },
  { key: "source", label: "Source", type: "select" },
  { key: "priority", label: "Priority", type: "select" },
  { key: "due", label: "Due date", type: "date" },
]

export function propertyOf(key: FilterPropertyKey): FilterProperty {
  return FILTER_PROPERTIES.find((property) => property.key === key) ?? FILTER_PROPERTIES[0]
}

export type Operator = { value: string; label: string; needsValue: boolean }

const TEXT_OPERATORS: Operator[] = [
  { value: "contains", label: "Contains", needsValue: true },
  { value: "not_contains", label: "Does not contain", needsValue: true },
  { value: "is", label: "Is", needsValue: true },
  { value: "is_not", label: "Is not", needsValue: true },
  { value: "is_empty", label: "Is empty", needsValue: false },
  { value: "is_not_empty", label: "Is not empty", needsValue: false },
]

const SELECT_OPERATORS: Operator[] = [
  { value: "is_any_of", label: "Is any of", needsValue: true },
  { value: "is_none_of", label: "Is none of", needsValue: true },
  { value: "is_empty", label: "Is empty", needsValue: false },
  { value: "is_not_empty", label: "Is not empty", needsValue: false },
]

const DATE_OPERATORS: Operator[] = [
  { value: "relative", label: "Is relative to today", needsValue: true },
  { value: "is", label: "Is", needsValue: true },
  { value: "before", label: "Is before", needsValue: true },
  { value: "after", label: "Is after", needsValue: true },
  { value: "on_or_before", label: "Is on or before", needsValue: true },
  { value: "on_or_after", label: "Is on or after", needsValue: true },
  { value: "between", label: "Is between", needsValue: true },
  { value: "is_empty", label: "Is empty", needsValue: false },
  { value: "is_not_empty", label: "Is not empty", needsValue: false },
]

export function operatorsFor(type: PropertyType): Operator[] {
  if (type === "date") return DATE_OPERATORS
  if (type === "select") return SELECT_OPERATORS
  return TEXT_OPERATORS
}

export function operatorMeta(type: PropertyType, value: string): Operator | undefined {
  return operatorsFor(type).find((operator) => operator.value === value)
}

export type RelativePreset =
  | "overdue"
  | "today"
  | "tomorrow"
  | "this_week"
  | "next_7_days"
  | "this_month"
  | "past"
  | "future"

export const RELATIVE_PRESETS: { value: RelativePreset; label: string }[] = [
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "this_week", label: "This week" },
  { value: "next_7_days", label: "Next 7 days" },
  { value: "this_month", label: "This month" },
  { value: "past", label: "In the past" },
  { value: "future", label: "In the future" },
]

// value shape is a union across operators; only the relevant field is read.
export type FilterValue = {
  text?: string
  values?: string[]
  date?: string // "YYYY-MM-DD"
  dateEnd?: string // "YYYY-MM-DD" (between)
  preset?: RelativePreset
}

export type FilterRule = {
  id: string
  property: FilterPropertyKey
  operator: string
  value: FilterValue
}

export type Conjunction = "and" | "or"
export type FilterState = { conjunction: Conjunction; rules: FilterRule[] }

export const EMPTY_FILTER: FilterState = { conjunction: "and", rules: [] }

// ── value access ─────────────────────────────────────────────────────────────

function textFieldOf(task: Task, key: FilterPropertyKey, nowMs: number): string | null {
  switch (key) {
    case "name":
      return task.title
    case "course":
      return task.course
    case "category":
      return task.category
    case "status":
      return taskStatusLabel(task, nowMs)
    case "source":
      return taskSourceLabel(task)
    case "priority":
      return priorityLabel(task.priority)
    default:
      return null
  }
}

// ── date helpers (local time) ────────────────────────────────────────────────

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
function endOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}
function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms))
  d.setDate(d.getDate() - d.getDay()) // Sunday-start week, matching the calendar UI
  return d.getTime()
}
function startOfMonth(ms: number): number {
  const d = new Date(startOfDay(ms))
  d.setDate(1)
  return d.getTime()
}
function endOfMonth(ms: number): number {
  const d = new Date(startOfDay(ms))
  d.setMonth(d.getMonth() + 1, 1)
  return d.getTime() - 1
}

// Parse a date-input "YYYY-MM-DD" as a LOCAL day (not UTC, which would shift it).
function parseLocalDate(value: string | undefined): number | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return null
  const [, y, m, d] = match
  return new Date(Number(y), Number(m) - 1, Number(d)).getTime()
}

function inRelativeWindow(t: number, preset: RelativePreset | undefined, nowMs: number): boolean {
  switch (preset) {
    case "overdue":
      return t < nowMs
    case "past":
      return t < startOfDay(nowMs)
    case "future":
      return t > endOfDay(nowMs)
    case "today":
      return t >= startOfDay(nowMs) && t <= endOfDay(nowMs)
    case "tomorrow": {
      const start = startOfDay(nowMs) + DAY
      return t >= start && t <= start + DAY - 1
    }
    case "this_week":
      return t >= startOfWeek(nowMs) && t <= startOfWeek(nowMs) + 7 * DAY - 1
    case "next_7_days":
      return t >= nowMs && t <= nowMs + 7 * DAY
    case "this_month":
      return t >= startOfMonth(nowMs) && t <= endOfMonth(nowMs)
    default:
      return true
  }
}

// ── evaluation ───────────────────────────────────────────────────────────────

function evaluateText(operator: string, field: string | null, raw: string | undefined): boolean {
  const f = (field ?? "").trim().toLowerCase()
  const v = (raw ?? "").trim().toLowerCase()
  switch (operator) {
    case "is_empty":
      return f === ""
    case "is_not_empty":
      return f !== ""
    case "contains":
      return v === "" ? true : f.includes(v)
    case "not_contains":
      return v === "" ? true : !f.includes(v)
    case "is":
      return v === "" ? true : f === v
    case "is_not":
      return v === "" ? true : f !== v
    default:
      return true
  }
}

function evaluateSelect(operator: string, field: string | null, values: string[] | undefined): boolean {
  const selected = (values ?? []).map((value) => value.toLowerCase())
  const f = (field ?? "").toLowerCase()
  switch (operator) {
    case "is_empty":
      return !field
    case "is_not_empty":
      return !!field
    case "is_any_of":
      return selected.length === 0 ? true : !!field && selected.includes(f)
    case "is_none_of":
      return selected.length === 0 ? true : !selected.includes(f)
    default:
      return true
  }
}

function evaluateDate(operator: string, deadline: string | null, value: FilterValue, nowMs: number): boolean {
  if (operator === "is_empty") return !deadline
  if (operator === "is_not_empty") return !!deadline
  if (!deadline) return false // any positive date constraint excludes undated tasks

  const t = new Date(deadline).getTime()
  if (Number.isNaN(t)) return false

  if (operator === "relative") return inRelativeWindow(t, value.preset, nowMs)

  const day = parseLocalDate(value.date)
  if (day === null) return true // no date picked yet → not yet a constraint
  const dayStart = startOfDay(day)
  const dayEnd = endOfDay(day)

  switch (operator) {
    case "before":
      return t < dayStart
    case "after":
      return t > dayEnd
    case "on_or_before":
      return t <= dayEnd
    case "on_or_after":
      return t >= dayStart
    case "is":
      return t >= dayStart && t <= dayEnd
    case "between": {
      const end = parseLocalDate(value.dateEnd)
      if (end === null) return true
      const lo = Math.min(dayStart, startOfDay(end))
      const hi = Math.max(dayEnd, endOfDay(end))
      return t >= lo && t <= hi
    }
    default:
      return true
  }
}

export function evaluateRule(rule: FilterRule, task: Task, nowMs: number): boolean {
  const property = propertyOf(rule.property)
  if (property.type === "date") {
    return evaluateDate(rule.operator, task.deadline, rule.value ?? {}, nowMs)
  }
  const field = textFieldOf(task, rule.property, nowMs)
  if (property.type === "select") {
    return evaluateSelect(rule.operator, field, rule.value?.values)
  }
  return evaluateText(rule.operator, field, rule.value?.text)
}

export function evaluateFilter(state: FilterState, task: Task, nowMs: number): boolean {
  if (!state.rules.length) return true
  const results = state.rules.map((rule) => evaluateRule(rule, task, nowMs))
  return state.conjunction === "or" ? results.some(Boolean) : results.every(Boolean)
}

// ── sort ─────────────────────────────────────────────────────────────────────

export type SortKey = "due" | "priority" | "name" | "course" | "category" | "status"
export type SortDirection = "asc" | "desc"
export type SortRule = { id: string; key: SortKey; direction: SortDirection }

export const SORT_KEYS: { key: SortKey; label: string }[] = [
  { key: "due", label: "Due date" },
  { key: "priority", label: "Priority" },
  { key: "name", label: "Name" },
  { key: "course", label: "Course" },
  { key: "category", label: "Category" },
  { key: "status", label: "Status" },
]

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 }

function activityRank(task: Task): number {
  if (task.status === "completed") return 1
  if (task.status === "missed") return 2
  return 0
}

function compareNullableText(left: string | null, right: string | null): number {
  if (left === right) return 0
  if (!left) return 1 // nulls last
  if (!right) return -1
  return left.localeCompare(right)
}

function compareByKey(left: Task, right: Task, key: SortKey, nowMs: number): number {
  switch (key) {
    case "due":
      return compareByDeadline(left, right)
    case "priority":
      return (PRIORITY_RANK[left.priority] ?? 1) - (PRIORITY_RANK[right.priority] ?? 1)
    case "name":
      return left.title.localeCompare(right.title)
    case "course":
      return compareNullableText(left.course, right.course)
    case "category":
      return compareNullableText(left.category, right.category)
    case "status":
      return TASK_STATUS_ORDER.indexOf(taskStatusLabel(left, nowMs)) - TASK_STATUS_ORDER.indexOf(taskStatusLabel(right, nowMs))
    default:
      return 0
  }
}

// Finished work always sinks below active work (so missed/completed never crowd
// the top of a list); the user's sort rules order within that, name breaks ties.
export function makeSortComparator(sorts: SortRule[], nowMs: number): (left: Task, right: Task) => number {
  return (left, right) => {
    const rank = activityRank(left) - activityRank(right)
    if (rank !== 0) return rank
    for (const sort of sorts) {
      const base = compareByKey(left, right, sort.key, nowMs)
      if (base !== 0) return sort.direction === "desc" ? -base : base
    }
    return left.title.localeCompare(right.title)
  }
}

// ── construction + summaries (UI helpers, but pure) ──────────────────────────

let ruleSeq = 0
function nextId(prefix: string): string {
  ruleSeq += 1
  return `${prefix}-${ruleSeq}`
}

export function defaultRuleForProperty(key: FilterPropertyKey): FilterRule {
  const type = propertyOf(key).type
  if (type === "date") return { id: nextId("rule"), property: key, operator: "relative", value: { preset: "this_week" } }
  if (type === "select") return { id: nextId("rule"), property: key, operator: "is_any_of", value: { values: [] } }
  return { id: nextId("rule"), property: key, operator: "contains", value: { text: "" } }
}

export function defaultSortRule(key: SortKey): SortRule {
  return { id: nextId("sort"), key, direction: "asc" }
}

// Reset a rule's value when its operator changes to a different shape.
export function valueForOperator(type: PropertyType, operator: string, previous: FilterValue): FilterValue {
  const meta = operatorMeta(type, operator)
  if (!meta?.needsValue) return {}
  if (type === "select") return { values: previous.values ?? [] }
  if (type === "date") {
    if (operator === "relative") return { preset: previous.preset ?? "this_week" }
    if (operator === "between") return { date: previous.date, dateEnd: previous.dateEnd }
    return { date: previous.date }
  }
  return { text: previous.text ?? "" }
}

// Compact human label for an active-rule pill ("Course contains math", "Due date:
// This week", "Status: any of Todo, Overdue").
export function ruleSummary(rule: FilterRule): string {
  const property = propertyOf(rule.property)
  const type = property.type
  const op = operatorMeta(type, rule.operator)
  if (!op?.needsValue) {
    return `${property.label} ${op?.label.toLowerCase() ?? rule.operator}`
  }
  if (type === "date") {
    if (rule.operator === "relative") {
      const preset = RELATIVE_PRESETS.find((p) => p.value === rule.value?.preset)
      return `${property.label}: ${preset?.label ?? "—"}`
    }
    if (rule.operator === "between") {
      return `${property.label} ${op.label.toLowerCase()} ${rule.value?.date ?? "…"} – ${rule.value?.dateEnd ?? "…"}`
    }
    return `${property.label} ${op.label.toLowerCase()} ${rule.value?.date ?? "…"}`
  }
  if (type === "select") {
    const values = rule.value?.values ?? []
    const shown = values.length === 0 ? "…" : values.length <= 2 ? values.join(", ") : `${values.length} values`
    return `${property.label} ${op.label.toLowerCase()} ${shown}`
  }
  return `${property.label} ${op.label.toLowerCase()} ${rule.value?.text || "…"}`
}
