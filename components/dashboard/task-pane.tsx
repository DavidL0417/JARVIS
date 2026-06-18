"use client"

import { useMemo, useState } from "react"
import { Check, ChevronDown, ChevronRight, RotateCcw, Search, Trash2, X } from "lucide-react"

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
        className="group flex items-start gap-2.5 rounded-sm px-2 py-[7px] transition-colors hover:bg-muted/20"
      >
        {missed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => void handleRestore(task)}
                aria-label="Restore to todo"
                className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
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
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors ${
              completed ? "border-copper bg-copper text-primary-foreground" : "border-rule-strong hover:border-foreground"
            }`}
          >
            {completed ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <p className={`line-clamp-2 text-[13px] leading-snug ${completed || missed ? "text-muted-foreground" : "text-foreground"} ${completed ? "line-through" : ""}`}>
            {task.title}
          </p>
          {(date || visibleTags.length > 0 || overdue || missed) ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              {overdue ? <span className="num font-medium uppercase text-destructive">Overdue</span> : null}
              {missed ? <span className="num font-medium uppercase text-muted-foreground">Missed</span> : null}
              {date ? <span className="num">{date}</span> : null}
              {visibleTags.length > 0 ? <span className="truncate">{visibleTags.join(" · ")}</span> : null}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => void onDeleteTask(task.id)}
                aria-label="Delete"
                className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-destructive"
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
      <div className="flex flex-col gap-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search all tasks"
            aria-label="Search all tasks"
            className="h-8 w-full rounded-sm border border-rule bg-transparent pl-7 pr-7 text-[12.5px] text-foreground placeholder:text-muted-foreground focus:border-rule-strong focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>

        {isSearching ? (
          <div>
            <div className="mb-2 flex items-baseline gap-2">
              <h3 className="eyebrow">Results</h3>
              <span className="num text-[11px] font-medium uppercase text-muted-foreground">{results.length}</span>
            </div>
            {results.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">No tasks match “{query.trim()}”.</p>
            ) : (
              <ul className="flex flex-col gap-0.5">{results.map(renderRow)}</ul>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="eyebrow">Group by</span>
              <div className="inline-flex w-fit rounded-sm border border-rule bg-secondary/10 p-0.5">
                {GROUP_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={groupBy === option.id}
                    onClick={() => setGroupBy(option.id)}
                    className={`rounded-sm px-2 py-1 text-[11px] transition-colors ${
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

            <div className="flex flex-col gap-5">
              {groups.length === 0 ? (
                <p className="text-[12.5px] text-muted-foreground">No tasks yet.</p>
              ) : (
                groups.map((group) => (
                  <div key={group.key}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.key)}
                      className="flex w-full items-center gap-2 py-1 text-left text-muted-foreground transition-colors hover:text-foreground"
                      aria-expanded={!isCollapsed(group.key)}
                    >
                      <h3 className="eyebrow truncate">{group.key}</h3>
                      <span className="num text-[11px] font-medium uppercase">{group.tasks.length}</span>
                      {isCollapsed(group.key) ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                    {!isCollapsed(group.key) ? (
                      <ul className="mt-1 flex flex-col gap-0.5">{group.tasks.map(renderRow)}</ul>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </RailSheet>
  )
}
