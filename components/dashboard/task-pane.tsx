"use client"

import { useMemo, useState } from "react"
import {
  AlertCircle,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleSlash,
  GraduationCap,
  Hash,
  ListChecks,
  NotebookText,
  RotateCcw,
  Search,
  Sparkles,
  Tag,
  Trash2,
  X,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { RailSheet } from "@/components/dashboard/rail-sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { searchTasks } from "@/lib/task-search"
import type { Task, UpdateTaskRequest } from "@/types"

type GroupBy = "source" | "status" | "tag"

// Kind/marker tags carry no grouping signal (the row already shows status, and the
// course is the meaningful tag). Hidden from the tag view and the row meta.
const NOISE_TAGS = new Set(["source-review", "task", "deadline", "event"])

const GROUP_OPTIONS: { id: GroupBy; label: string }[] = [
  { id: "source", label: "Source" },
  { id: "status", label: "Status" },
  { id: "tag", label: "Tag" },
]

function taskSourceLabel(task: Task): string {
  if (task.lastSyncedFrom === "notion") return "Notion"
  if (task.lastSyncedFrom === "apple_reminders") return "Apple Reminders"
  if (task.lastSyncedFrom === "caldav") return "Apple Calendar"
  if (task.tags.includes("canvas")) return "Canvas"
  return "JARVIS"
}

function isOverdue(task: Task, nowMs: number): boolean {
  return (
    task.status !== "completed" &&
    task.status !== "missed" &&
    Boolean(task.deadline) &&
    new Date(task.deadline as string).getTime() < nowMs
  )
}

function statusLabel(task: Task, nowMs: number): string {
  if (task.status === "completed") return "Completed"
  if (task.status === "missed") return "Missed"
  if (isOverdue(task, nowMs)) return "Overdue"
  if (task.status === "scheduled" || task.scheduledFor) return "Scheduled"
  return "Todo"
}

function deadlineLabel(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

// A group's leading glyph. Source channels carry their DESIGN.md signal hue (the
// "abstract source channels flowing into a plan"); status uses semantic color;
// JARVIS-native tasks wear the brand copper. `tone` is a CSS var/color string,
// `className` a token utility — at most one is set.
type Glyph = { Icon: LucideIcon; tone?: string; className?: string }

function sourceGlyph(key: string): Glyph {
  switch (key) {
    case "Notion":
      return { Icon: NotebookText, tone: "var(--signal-blue)" }
    case "Canvas":
      return { Icon: GraduationCap, tone: "var(--signal-teal)" }
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
  return { Icon: Hash, className: "text-muted-foreground" }
}

function pushInto(map: Map<string, Task[]>, key: string, task: Task) {
  const existing = map.get(key)
  if (existing) {
    existing.push(task)
  } else {
    map.set(key, [task])
  }
}

const STATUS_ORDER = ["Overdue", "Todo", "Scheduled", "Completed", "Missed"]
const SOURCE_ORDER = ["Notion", "Canvas", "Apple Reminders", "Apple Calendar", "JARVIS"]

// Only the Status view collapses Completed/Missed by default; a free-form tag that
// happens to be named "Completed" stays expanded.
function defaultCollapsed(groupBy: GroupBy, key: string): boolean {
  return groupBy === "status" && (key === "Completed" || key === "Missed")
}

function compareForList(left: Task, right: Task): number {
  const leftMs = left.deadline ? new Date(left.deadline).getTime() : Number.POSITIVE_INFINITY
  const rightMs = right.deadline ? new Date(right.deadline).getTime() : Number.POSITIVE_INFINITY
  if (leftMs !== rightMs) return leftMs - rightMs
  return left.title.localeCompare(right.title)
}

type Group = { key: string; tasks: Task[] }

function buildGroups(tasks: Task[], groupBy: GroupBy, nowMs: number): Group[] {
  const map = new Map<string, Task[]>()

  if (groupBy === "tag") {
    for (const task of tasks) {
      const tags = [...new Set(task.tags.filter((tag) => !NOISE_TAGS.has(tag)))]
      if (tags.length === 0) {
        pushInto(map, "Untagged", task)
      } else {
        for (const tag of tags) pushInto(map, tag, task)
      }
    }
    const entries = [...map.entries()]
      .filter(([key]) => key !== "Untagged")
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    if (map.has("Untagged")) entries.push(["Untagged", map.get("Untagged") as Task[]])
    return entries.map(([key, groupTasks]) => ({ key, tasks: groupTasks.slice().sort(compareForList) }))
  }

  const labelOf = groupBy === "status" ? (t: Task) => statusLabel(t, nowMs) : taskSourceLabel
  const order = groupBy === "status" ? STATUS_ORDER : SOURCE_ORDER
  for (const task of tasks) pushInto(map, labelOf(task), task)
  const ordered = [
    ...order.filter((label) => map.has(label)),
    ...[...map.keys()].filter((label) => !order.includes(label)).sort(),
  ]
  return ordered.map((key) => ({ key, tasks: (map.get(key) as Task[]).slice().sort(compareForList) }))
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  // Stable enough for status/overdue grouping; recompute only when the task set
  // changes so the groups memo isn't invalidated on every keystroke.
  const nowMs = useMemo(() => Date.now(), [tasks])
  const isSearching = query.trim().length > 0

  const groups = useMemo(() => buildGroups(tasks, groupBy, nowMs), [tasks, groupBy, nowMs])
  // Pre-sort by deadline so equal-relevance search ties stay deadline-ordered
  // (matches the rail search surface).
  const results = useMemo(() => searchTasks([...tasks].sort(compareForList), query), [tasks, query])

  // Collapse state is namespaced per view so a tag named "Completed" doesn't inherit
  // the Status view's collapse, and views don't cross-contaminate.
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

  const renderRow = (task: Task) => {
    const overdue = isOverdue(task, nowMs)
    const completed = task.status === "completed"
    const missed = task.status === "missed"
    const date = deadlineLabel(task.deadline)
    const visibleTags = task.tags.filter((tag) => !NOISE_TAGS.has(tag))

    return (
      <li
        key={task.id}
        className="group flex items-start gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-muted/30"
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
          <button
            type="button"
            onClick={() => void handleToggleComplete(task)}
            aria-label={completed ? "Mark todo" : "Mark complete"}
            className={`mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors ${
              completed
                ? "border-copper bg-copper text-primary-foreground"
                : "border-rule-strong hover:border-copper"
            }`}
          >
            {completed ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p
            className={`line-clamp-2 text-[13px] leading-snug ${
              completed ? "text-muted-foreground line-through" : missed ? "text-muted-foreground" : "text-foreground"
            }`}
          >
            {task.title}
          </p>
          {date || visibleTags.length > 0 || overdue || missed ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
              {overdue ? (
                <span className="num inline-flex items-center gap-1 font-medium uppercase tracking-wide text-destructive">
                  <AlertCircle className="h-3 w-3" /> Overdue
                </span>
              ) : null}
              {missed ? (
                <span className="num inline-flex items-center gap-1 font-medium uppercase tracking-wide text-muted-foreground/80">
                  <CircleSlash className="h-3 w-3" /> Missed
                </span>
              ) : null}
              {date ? (
                <span className="num inline-flex items-center gap-1">
                  <CalendarClock className="h-3 w-3 text-muted-foreground/70" /> {date}
                </span>
              ) : null}
              {visibleTags.length > 0 ? (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <Tag className="h-3 w-3 shrink-0 text-muted-foreground/70" />
                  <span className="truncate">{visibleTags.join(" · ")}</span>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => void onDeleteTask(task.id)}
                aria-label="Delete"
                className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
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
              <ul className="flex flex-col gap-0.5">{results.map(renderRow)}</ul>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2.5">
              <span className="eyebrow">Group by</span>
              <div className="inline-flex w-fit gap-0.5 rounded-md border border-rule bg-muted/20 p-0.5">
                {GROUP_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={groupBy === option.id}
                    onClick={() => setGroupBy(option.id)}
                    className={`rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                      groupBy === option.id
                        ? "bg-copper-soft text-copper"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-6">
              {groups.length === 0 ? (
                <p className="px-2 text-[12.5px] text-muted-foreground">No tasks yet.</p>
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
                        <ul className="mt-1.5 flex flex-col gap-0.5">{group.tasks.map(renderRow)}</ul>
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
