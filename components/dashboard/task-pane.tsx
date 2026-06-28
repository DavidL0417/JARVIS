"use client"

import { useMemo, useState } from "react"
import type { ReactNode } from "react"
import {
  AlertCircle,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleSlash,
  GraduationCap,
  ListChecks,
  Mail,
  NotebookText,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { RailSheet } from "@/components/dashboard/rail-sheet"
import { TaskCheckbox } from "@/components/dashboard/task-row"
import { FilterControls, SortControls } from "@/components/dashboard/task-filter-controls"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  NOISE_TAGS,
  TASK_PRIORITY_ORDER,
  TASK_SOURCE_ORDER,
  TASK_STATUS_ORDER,
  formatDeadlineShort,
  isTaskOverdue,
  priorityLabel,
  shortCourseLabel,
  taskSourceLabel,
  taskStatusLabel,
} from "@/lib/task-display"
import {
  EMPTY_FILTER,
  evaluateFilter,
  makeSortComparator,
  type FilterPropertyKey,
  type FilterState,
  type SortRule,
} from "@/lib/task-filter"
import { searchTasks } from "@/lib/task-search"
import type { Task, UpdateTaskRequest } from "@/types"

type GroupBy = "source" | "status" | "course"

const GROUP_OPTIONS: { id: GroupBy; label: string }[] = [
  { id: "source", label: "Source" },
  { id: "status", label: "Status" },
  { id: "course", label: "Course" },
]

const NO_COURSE = "No course"
const DEFAULT_SORTS: SortRule[] = [{ id: "sort-default-due", key: "due", direction: "asc" }]

function courseKey(task: Task): string {
  return task.course?.trim() || NO_COURSE
}

// A group's leading glyph. Source channels carry their DESIGN.md signal hue; status
// uses semantic color; JARVIS-native tasks wear the brand copper. `tone` is a CSS
// var/color string, `className` a token utility — at most one is set.
type Glyph = { Icon: LucideIcon; tone?: string; className?: string }

function sourceGlyph(key: string): Glyph {
  switch (key) {
    case "Notion":
      return { Icon: NotebookText, tone: "var(--signal-blue)" }
    case "Canvas":
      return { Icon: GraduationCap, tone: "var(--signal-teal)" }
    case "Gmail":
      return { Icon: Mail, tone: "var(--signal-copper)" }
    case "Apple Reminders":
      return { Icon: ListChecks, tone: "var(--signal-green)" }
    case "Apple Calendar":
      return { Icon: CalendarDays, tone: "var(--signal-teal)" }
    default:
      return { Icon: Sparkles, className: "text-copper" }
  }
}

function statusGlyph(key: string): Glyph {
  switch (key) {
    case "Overdue":
      return { Icon: AlertCircle, className: "text-destructive" }
    case "Scheduled":
      return { Icon: CalendarClock, className: "text-copper" }
    case "Completed":
      return { Icon: CheckCircle2, tone: "var(--signal-green)" }
    case "Missed":
      return { Icon: CircleSlash, className: "text-muted-foreground" }
    default:
      return { Icon: Circle, className: "text-muted-foreground" }
  }
}

function groupGlyph(groupBy: GroupBy, key: string): Glyph {
  if (groupBy === "source") return sourceGlyph(key)
  if (groupBy === "status") return statusGlyph(key)
  return { Icon: GraduationCap, className: key === NO_COURSE ? "text-muted-foreground" : "text-copper" }
}

function pushInto(map: Map<string, Task[]>, key: string, task: Task) {
  const existing = map.get(key)
  if (existing) {
    existing.push(task)
  } else {
    map.set(key, [task])
  }
}

// Only the Status view collapses Completed/Missed by default; a free-form course or
// source that happens to be named "Completed" stays expanded.
function defaultCollapsed(groupBy: GroupBy, key: string): boolean {
  return groupBy === "status" && (key === "Completed" || key === "Missed")
}

type Group = { key: string; tasks: Task[] }

function buildGroups(
  tasks: Task[],
  groupBy: GroupBy,
  nowMs: number,
  comparator: (left: Task, right: Task) => number,
): Group[] {
  const map = new Map<string, Task[]>()

  if (groupBy === "course") {
    for (const task of tasks) pushInto(map, courseKey(task), task)
    const entries = [...map.entries()]
      .filter(([key]) => key !== NO_COURSE)
      .sort((a, b) => a[0].localeCompare(b[0]))
    if (map.has(NO_COURSE)) entries.push([NO_COURSE, map.get(NO_COURSE) as Task[]])
    return entries.map(([key, groupTasks]) => ({ key, tasks: groupTasks.slice().sort(comparator) }))
  }

  const labelOf = groupBy === "status" ? (t: Task) => taskStatusLabel(t, nowMs) : taskSourceLabel
  const order = groupBy === "status" ? TASK_STATUS_ORDER : TASK_SOURCE_ORDER
  for (const task of tasks) pushInto(map, labelOf(task), task)
  const ordered = [
    ...order.filter((label) => map.has(label)),
    ...[...map.keys()].filter((label) => !order.includes(label)).sort(),
  ]
  return ordered.map((key) => ({ key, tasks: (map.get(key) as Task[]).slice().sort(comparator) }))
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="inline-flex w-fit gap-0.5 rounded-md border border-rule bg-muted/20 p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
            value === option.id ? "bg-copper-soft text-copper" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

const PRIORITY_CHIP: Record<string, string> = {
  high: "border-destructive/30 bg-destructive/10 text-destructive",
  medium: "border-rule bg-muted/30 text-muted-foreground",
  low: "border-rule bg-transparent text-muted-foreground/80",
}

function Chip({ className, title, children }: { className: string; title?: string; children: ReactNode }) {
  return (
    <span
      title={title}
      className={`inline-flex max-w-full items-center truncate rounded-[5px] border px-1.5 py-[1px] text-[10.5px] leading-[15px] ${className}`}
    >
      {children}
    </span>
  )
}

export function TaskPane({
  isOpen,
  onClose,
  tasks,
  onUpdateTask,
  onDeleteTask,
}: {
  isOpen: boolean
  onClose: () => void
  tasks: Task[]
  onUpdateTask: (taskId: string, input: UpdateTaskRequest) => Promise<void> | void
  onDeleteTask: (taskId: string) => Promise<void> | void
}) {
  const [query, setQuery] = useState("")
  const [groupBy, setGroupBy] = useState<GroupBy>("source")
  const [sorts, setSorts] = useState<SortRule[]>(DEFAULT_SORTS)
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  // Rows with a delete in flight, so the click reads as acknowledged across the
  // DELETE + dashboard-reload round-trip instead of sitting there inert.
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())

  // Stable enough for status/overdue grouping; recompute only when the task set
  // changes so the groups memo isn't invalidated on every keystroke.
  const nowMs = useMemo(() => Date.now(), [tasks])
  const isSearching = query.trim().length > 0

  // Available values for the select-property filter editors (Category is data-
  // derived; Status/Source/Priority use the canonical order, filtered to present).
  const facetValues = useMemo(() => {
    const category = new Set<string>()
    const source = new Set<string>()
    const priority = new Set<string>()
    for (const task of tasks) {
      if (task.category) category.add(task.category)
      source.add(taskSourceLabel(task))
      priority.add(priorityLabel(task.priority))
    }
    return {
      category: [...category].sort(),
      source: TASK_SOURCE_ORDER.filter((value) => source.has(value)),
      priority: TASK_PRIORITY_ORDER.filter((value) => priority.has(value)),
    }
  }, [tasks])

  const optionsFor = (key: FilterPropertyKey): string[] => {
    if (key === "category") return facetValues.category
    if (key === "source") return facetValues.source
    if (key === "priority") return facetValues.priority
    if (key === "status") return TASK_STATUS_ORDER
    return []
  }

  const comparator = useMemo(() => makeSortComparator(sorts, nowMs), [sorts, nowMs])
  const filteredTasks = useMemo(
    () => tasks.filter((task) => evaluateFilter(filter, task, nowMs)),
    [tasks, filter, nowMs],
  )
  const groups = useMemo(() => buildGroups(filteredTasks, groupBy, nowMs, comparator), [filteredTasks, groupBy, nowMs, comparator])
  // Pre-sort so equal-relevance search ties fall back to the chosen ordering.
  const results = useMemo(() => searchTasks([...filteredTasks].sort(comparator), query), [filteredTasks, comparator, query])

  // Collapse state is namespaced per view so a course named "Completed" doesn't
  // inherit the Status view's collapse, and views don't cross-contaminate.
  const collapseKey = (key: string) => `${groupBy}:${key}`
  const isCollapsed = (key: string) => collapsed[collapseKey(key)] ?? defaultCollapsed(groupBy, key)
  const toggleGroup = (key: string) =>
    setCollapsed((current) => ({ ...current, [collapseKey(key)]: !isCollapsed(key) }))

  const handleToggleComplete = (task: Task) => {
    if (task.status === "missed") {
      return handleRestore(task)
    }
    return onUpdateTask(task.id, { status: task.status === "completed" ? "todo" : "completed" })
  }

  const handleRestore = (task: Task) => {
    // Bring a missed/aged-out task back as a todo; drop a past deadline so the
    // server's 7-day sweep can't immediately re-miss it. Evaluated at click time.
    const stale = task.deadline ? new Date(task.deadline).getTime() < Date.now() : false
    return onUpdateTask(task.id, { status: "todo", ...(stale ? { deadline: null } : {}) })
  }

  const handleDelete = async (taskId: string) => {
    if (deletingIds.has(taskId)) return
    setDeletingIds((current) => new Set(current).add(taskId))
    try {
      await onDeleteTask(taskId)
    } finally {
      setDeletingIds((current) => {
        const next = new Set(current)
        next.delete(taskId)
        return next
      })
    }
  }

  const renderCard = (task: Task) => {
    const overdue = isTaskOverdue(task, nowMs)
    const completed = task.status === "completed"
    const missed = task.status === "missed"
    const date = formatDeadlineShort(task.deadline)
    const course = shortCourseLabel(task.course)
    const sourceLabel = taskSourceLabel(task)
    const sGlyph = sourceGlyph(sourceLabel)
    // Free-form tags only — source markers and the facets already shown as chips
    // are filtered out so nothing renders twice.
    const extraTags = task.tags.filter(
      (tag) => !NOISE_TAGS.has(tag) && tag !== task.course && tag !== task.category,
    )
    const pending = deletingIds.has(task.id)

    return (
      <li
        key={task.id}
        aria-busy={pending || undefined}
        className={`group relative flex min-w-0 gap-2 rounded-md border border-rule/50 bg-muted/10 px-2.5 py-2 transition-colors hover:bg-muted/30 ${
          pending ? "pointer-events-none opacity-50" : ""
        }`}
      >
        {missed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => void handleRestore(task)}
                aria-label="Restore to todo"
                className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground/70 transition-colors hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px]">Restore to todo</TooltipContent>
          </Tooltip>
        ) : (
          <TaskCheckbox
            checked={completed}
            onToggle={() => handleToggleComplete(task)}
            className="mt-px rounded-[5px]"
            uncheckedClassName="border-rule-strong hover:border-copper"
          />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p
              className={`line-clamp-2 text-[12.5px] font-medium leading-snug ${
                completed ? "text-muted-foreground line-through" : missed ? "text-muted-foreground" : "text-foreground"
              }`}
            >
              {task.title}
            </p>
            {overdue ? (
              <span className="num mt-px inline-flex shrink-0 items-center gap-1 text-[10.5px] font-medium uppercase tracking-wide text-destructive">
                <AlertCircle className="h-3 w-3" /> {date ?? "Due"}
              </span>
            ) : date ? (
              <span className="num mt-px inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[10.5px] text-muted-foreground">
                <CalendarClock className="h-3 w-3 text-muted-foreground/70" /> {date}
              </span>
            ) : null}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <sGlyph.Icon
                  className={`h-3.5 w-3.5 shrink-0 ${sGlyph.className ?? ""}`}
                  style={sGlyph.tone ? { color: sGlyph.tone } : undefined}
                  aria-label={sourceLabel}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="text-[11px]">{sourceLabel}</TooltipContent>
            </Tooltip>
            {course ? (
              <Chip className="border-copper/30 bg-copper-soft text-copper" title={task.course ?? undefined}>
                {course}
              </Chip>
            ) : null}
            {task.category ? <Chip className="border-rule bg-muted/40 text-muted-foreground">{task.category}</Chip> : null}
            <Chip className={PRIORITY_CHIP[task.priority] ?? PRIORITY_CHIP.medium}>{priorityLabel(task.priority)}</Chip>
            {extraTags.map((tag) => (
              <Chip key={tag} className="border-rule bg-muted/20 text-muted-foreground">
                {tag}
              </Chip>
            ))}
          </div>
        </div>

        <div className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => void handleDelete(task.id)}
                aria-label="Delete"
                className="flex h-6 w-6 items-center justify-center rounded-sm bg-background/80 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px]">Delete</TooltipContent>
          </Tooltip>
        </div>
      </li>
    )
  }

  return (
    <RailSheet isOpen={isOpen} onClose={onClose} title="Tasks" width="wide">
      <div className="flex flex-col gap-5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search all tasks"
            aria-label="Search all tasks"
            className="h-9 w-full rounded-md border border-rule bg-muted/20 pl-8 pr-8 text-[13px] text-foreground transition-colors placeholder:text-muted-foreground focus:border-copper focus:bg-transparent focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {isSearching ? (
          <div>
            <div className="mb-2.5 flex items-center gap-2">
              <Search className="h-3.5 w-3.5 text-copper" aria-hidden="true" />
              <h3 className="eyebrow">Results</h3>
              <span className="num rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {results.length}
              </span>
            </div>
            {results.length === 0 ? (
              <p className="px-2 text-[12.5px] text-muted-foreground">No tasks match “{query.trim()}”.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">{results.map(renderCard)}</ul>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex items-center gap-2.5">
                  <span className="eyebrow">Group by</span>
                  <Segmented options={GROUP_OPTIONS} value={groupBy} onChange={setGroupBy} />
                </div>
                <SortControls sorts={sorts} onChange={setSorts} />
              </div>
              <FilterControls state={filter} onChange={setFilter} optionsFor={optionsFor} />
            </div>

            <div className="flex flex-col gap-6">
              {groups.length === 0 ? (
                <p className="px-2 text-[12.5px] text-muted-foreground">
                  {filter.rules.length > 0 ? "No tasks match these filters." : "No tasks yet."}
                </p>
              ) : (
                groups.map((group) => {
                  const glyph = groupGlyph(groupBy, group.key)
                  const open = !isCollapsed(group.key)
                  return (
                    <div key={group.key}>
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.key)}
                        className="group/h flex w-full items-center gap-2 border-b border-rule/60 pb-1.5 text-left transition-colors"
                        aria-expanded={open}
                      >
                        <glyph.Icon
                          className={`h-3.5 w-3.5 shrink-0 ${glyph.className ?? ""}`}
                          style={glyph.tone ? { color: glyph.tone } : undefined}
                          aria-hidden="true"
                        />
                        <h3 className="eyebrow truncate text-foreground/90">{group.key}</h3>
                        <span className="num rounded-full bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {group.tasks.length}
                        </span>
                        {open ? (
                          <ChevronDown className="ml-auto h-3.5 w-3.5 text-muted-foreground transition-colors group-hover/h:text-foreground" />
                        ) : (
                          <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground transition-colors group-hover/h:text-foreground" />
                        )}
                      </button>
                      {open ? (
                        <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">{group.tasks.map(renderCard)}</ul>
                      ) : null}
                    </div>
                  )
                })
              )}
            </div>
          </>
        )}
      </div>
    </RailSheet>
  )
}
