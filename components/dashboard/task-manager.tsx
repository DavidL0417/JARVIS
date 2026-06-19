"use client"

import { useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react"

import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { RailSection } from "@/components/dashboard/rail-section"
import { TaskRow, TaskCheckbox } from "@/components/dashboard/task-row"
import { TASKS_CALENDAR_ID } from "@/lib/task-calendar-constants"
import { NOISE_TAGS, compareByDeadline, formatDeadlineShort, isTaskOverdue, shortCourseLabel } from "@/lib/task-display"
import { searchTasks } from "@/lib/task-search"
import type { Calendar } from "./calendars-sidebar"
import type { CreateTaskRequest, ScheduleEvent, Task, UpdateTaskRequest } from "@/types"

type TaskManagerMode = "all" | "calendar"

interface TaskManagerProps {
  mode?: TaskManagerMode
  calendar?: Calendar | null
  calendars: Calendar[]
  tasks: Task[]
  scheduleEvents?: ScheduleEvent[]
  errorMessage?: string | null
  onClearError?: () => void
  onCreateTask: (input: CreateTaskRequest) => Promise<void> | void
  onUpdateTask: (taskId: string, input: UpdateTaskRequest) => Promise<void> | void
  onDeleteTask: (taskId: string) => Promise<void> | void
}

type TaskDraft = {
  title: string
  deadline: string
  tags: string
  calendarId: string
}

const EMPTY_DRAFT: TaskDraft = {
  title: "",
  deadline: "",
  tags: "",
  calendarId: "",
}

function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
}

function toDateTimeInputValue(value: string | null) {
  if (!value) {
    return ""
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ""
  }

  const offsetMilliseconds = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMilliseconds).toISOString().slice(0, 16)
}

function toIsoDateTime(value: string) {
  return value ? new Date(value).toISOString() : null
}

function hasScheduledBlock(task: Task, scheduledTaskIds: Set<string>) {
  return task.status === "scheduled" || Boolean(task.scheduledFor) || scheduledTaskIds.has(task.id)
}

function compareTasks(left: Task, right: Task, taskIndex: Map<string, number>) {
  const byDeadline = compareByDeadline(left, right)

  if (byDeadline !== 0) {
    return byDeadline
  }

  const priorityWeight = { high: 0, medium: 1, low: 2 }
  const leftPriority = priorityWeight[left.priority]
  const rightPriority = priorityWeight[right.priority]

  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority
  }

  return (taskIndex.get(left.id) ?? 0) - (taskIndex.get(right.id) ?? 0)
}

export function TaskManager({
  mode = "calendar",
  calendar,
  calendars,
  tasks,
  scheduleEvents = [],
  errorMessage,
  onClearError,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
}: TaskManagerProps) {
  const [showCompleted, setShowCompleted] = useState(false)
  const [showScheduled, setShowScheduled] = useState(false)
  const [query, setQuery] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [createDraft, setCreateDraft] = useState<TaskDraft>(EMPTY_DRAFT)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<TaskDraft>(EMPTY_DRAFT)
  // Rows with a delete/unschedule in flight, so the click reads as acknowledged
  // across the mutation + dashboard-reload round-trip.
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set())

  const nowMs = Date.now()
  const taskIndex = useMemo(() => new Map(tasks.map((task, index) => [task.id, index])), [tasks])
  const scheduledTaskIds = useMemo(
    () =>
      new Set(
        scheduleEvents
          .map((event) => event.taskId)
          .filter((taskId): taskId is string => typeof taskId === "string" && taskId.length > 0),
      ),
    [scheduleEvents],
  )
  const defaultCalendarId = mode === "calendar" && calendar && calendar.id !== TASKS_CALENDAR_ID ? calendar.id : ""

  const filteredTasks = useMemo(() => {
    if (mode === "all") {
      return tasks
    }

    if (!calendar) {
      return []
    }

    if (calendar.id === TASKS_CALENDAR_ID) {
      return tasks
    }

    return tasks.filter((task) => task.calendarId === calendar.id)
  }, [calendar, mode, tasks])

  const sortedTasks = useMemo(
    () => [...filteredTasks].sort((left, right) => compareTasks(left, right, taskIndex)),
    [filteredTasks, taskIndex],
  )

  // Missed work lives in the "Needs you" Archive, not here — surfacing it as
  // "overdue" was the pile-up the refactor was meant to clear.
  const liveTasks = sortedTasks.filter((task) => task.status !== "completed" && task.status !== "missed")
  const completedTasks = sortedTasks.filter((task) => task.status === "completed")

  // Open work that needs a decision: anything unscheduled, plus anything overdue
  // (overdue floats up even if it carries a stale block).
  const actionableTasks = liveTasks.filter(
    (task) => !hasScheduledBlock(task, scheduledTaskIds) || isTaskOverdue(task, nowMs),
  )
  // Already placed on the calendar grid — folded away by default so the rail
  // stops duplicating the schedule.
  const scheduledTasks = liveTasks.filter(
    (task) => hasScheduledBlock(task, scheduledTaskIds) && !isTaskOverdue(task, nowMs),
  )

  // Instant client-side lookup across every task (any status), matched on title +
  // tags. Pure in-memory substring filter so it narrows on each keystroke with no
  // network round-trip. When active, it replaces the sectioned view.
  const searchResults = useMemo(() => searchTasks(sortedTasks, query), [query, sortedTasks])
  const isSearching = query.trim().length > 0

  const headerTitle = mode === "all" ? "Tasks" : calendar ? calendar.name : "Tasks"

  const resetCreateDraft = () => {
    setCreateDraft({
      ...EMPTY_DRAFT,
      calendarId: defaultCalendarId,
    })
  }

  useEffect(() => {
    setCreateDraft({
      ...EMPTY_DRAFT,
      calendarId: defaultCalendarId,
    })
  }, [defaultCalendarId])

  const handleCreate = async () => {
    if (!createDraft.title.trim()) {
      return
    }

    onClearError?.()

    await onCreateTask({
      title: createDraft.title.trim(),
      deadline: toIsoDateTime(createDraft.deadline),
      calendarId: createDraft.calendarId || null,
      tags: parseTags(createDraft.tags),
    })

    resetCreateDraft()
    setCreateOpen(false)
  }

  const handleToggleComplete = async (task: Task) => {
    onClearError?.()
    await onUpdateTask(task.id, {
      status: task.status === "completed" ? "todo" : "completed",
    })
  }

  const handleStartEditing = (task: Task) => {
    setEditingTaskId(task.id)
    setEditDraft({
      title: task.title,
      deadline: toDateTimeInputValue(task.deadline),
      tags: task.tags.join(", "),
      calendarId: task.calendarId ?? "",
    })
  }

  const handleSaveEdit = async (taskId: string) => {
    if (!editDraft.title.trim()) {
      return
    }

    onClearError?.()

    await onUpdateTask(taskId, {
      title: editDraft.title.trim(),
      deadline: toIsoDateTime(editDraft.deadline),
      tags: parseTags(editDraft.tags),
      calendarId: editDraft.calendarId || null,
    })

    setEditingTaskId(null)
  }

  const handleRemoveTask = async (task: Task) => {
    if (removingIds.has(task.id)) return
    onClearError?.()
    const isScheduledTask = task.status === "scheduled" || Boolean(task.scheduledFor)

    setRemovingIds((current) => new Set(current).add(task.id))
    try {
      if (isScheduledTask) {
        await onUpdateTask(task.id, {
          status: task.status === "completed" ? "completed" : "todo",
          scheduledFor: null,
        })
        return
      }

      await onDeleteTask(task.id)
    } finally {
      // On success the row is gone (deleted) or moved out of this list
      // (unscheduled); on failure it stays and un-dims for the inline error.
      setRemovingIds((current) => {
        const next = new Set(current)
        next.delete(task.id)
        return next
      })
    }
  }

  const renderTaskRow = (task: Task, index: number) => {
    const isEditing = editingTaskId === task.id
    const isScheduledTask = hasScheduledBlock(task, scheduledTaskIds)
    const overdue = isTaskOverdue(task, nowMs)
    const deadlineLabel = formatDeadlineShort(task.deadline)
    const calendarName =
      task.calendarId && task.calendarId !== TASKS_CALENDAR_ID
        ? calendars.find((c) => c.id === task.calendarId)?.name
        : null
    const calendarColor = calendarName ? calendars.find((c) => c.id === task.calendarId)?.color : null
    // Course + category lead the meta line; free-form tags (minus source markers
    // and the facets already shown) trail. The redundant source tag is gone.
    const courseLabel = shortCourseLabel(task.course)
    const meta = [
      calendarName,
      courseLabel,
      task.category,
      ...task.tags.filter((tag) => !NOISE_TAGS.has(tag) && tag !== task.course && tag !== task.category),
    ].filter(Boolean) as string[]

    if (isEditing) {
      return (
        <li key={task.id} className="rounded-sm bg-muted/20 px-2.5 py-2.5">
          <div className="flex flex-col gap-2">
            <Input
              value={editDraft.title}
              onChange={(event) => setEditDraft((current) => ({ ...current, title: event.target.value }))}
              className="h-8 border-0 border-b border-rule bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0"
              autoFocus
            />
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
              <Input
                type="datetime-local"
                value={editDraft.deadline}
                onChange={(event) => setEditDraft((current) => ({ ...current, deadline: event.target.value }))}
                className="num h-7 border-rule bg-transparent text-[11px]"
              />
              <Input
                value={editDraft.tags}
                onChange={(event) => setEditDraft((current) => ({ ...current, tags: event.target.value }))}
                placeholder="tag, tag"
                className="h-7 border-rule bg-transparent text-[11px]"
              />
              <select
                value={editDraft.calendarId}
                onChange={(event) => setEditDraft((current) => ({ ...current, calendarId: event.target.value }))}
                className="h-7 rounded-sm border border-rule bg-transparent px-2 text-[11px] text-foreground"
              >
                <option value="">No calendar</option>
                {calendars.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-1">
              <button
                type="button"
                onClick={() => setEditingTaskId(null)}
                aria-label="Cancel"
                className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void handleSaveEdit(task.id)}
                aria-label="Save"
                className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </li>
      )
    }

    return (
      <TaskRow
        key={task.id}
        pending={removingIds.has(task.id)}
        leading={
          <>
            <span className="num mt-0.5 w-4 shrink-0 text-[10.5px] font-medium tabular-nums text-muted-foreground">
              {String(index + 1).padStart(2, "0")}
            </span>
            <TaskCheckbox
              checked={task.status === "completed"}
              onToggle={() => void handleToggleComplete(task)}
              className="mt-0.5 rounded-sm"
            />
          </>
        }
        title={task.title}
        titleClassName={
          task.status === "completed" ? "text-muted-foreground line-through" : "text-foreground"
        }
        titleAside={
          overdue ? (
            <span className="num mt-px inline-flex shrink-0 items-center gap-1 text-[11px] font-medium uppercase text-destructive">
              <AlertCircle className="h-3 w-3" />
              {deadlineLabel ?? "Overdue"}
            </span>
          ) : deadlineLabel ? (
            <span className="num mt-px inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
              <CalendarClock className="h-3 w-3" />
              {deadlineLabel}
            </span>
          ) : null
        }
        meta={
          meta.length > 0 ? (
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
              {calendarColor ? (
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: calendarColor }}
                  aria-hidden="true"
                />
              ) : null}
              <span className="truncate">{meta.join(" · ")}</span>
            </p>
          ) : null
        }
        actions={
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => handleStartEditing(task)}
                  aria-label="Edit"
                  className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-[11px]">Edit</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => void handleRemoveTask(task)}
                  aria-label={isScheduledTask ? "Unschedule" : "Delete"}
                  className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-destructive"
                >
                  {isScheduledTask ? <X className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-[11px]">
                {isScheduledTask ? "Unschedule" : "Delete"}
              </TooltipContent>
            </Tooltip>
          </>
        }
      />
    )
  }

  if (mode === "calendar" && !calendar) {
    return (
      <section>
        <h2 className="eyebrow mb-3">Tasks</h2>
        <p className="text-[12px] text-muted-foreground">Pick a calendar to filter tasks.</p>
      </section>
    )
  }

  return (
    <RailSection
      title={headerTitle}
      count={actionableTasks.length}
      action={
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setCreateOpen((current) => !current)}
              aria-label="Add task"
              aria-expanded={createOpen}
              className={`flex h-7 w-7 items-center justify-center rounded-sm transition-colors ${
                createOpen ? "bg-copper-soft text-copper" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              <Plus className={`h-4 w-4 transition-transform ${createOpen ? "rotate-45" : ""}`} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-[11px]">Add task</TooltipContent>
        </Tooltip>
      }
    >
      {errorMessage ? (
        <p className="mb-2 text-[12px] text-destructive">{errorMessage}</p>
      ) : null}

      {createOpen ? (
        <div className="mb-4 flex flex-col gap-2 rounded-sm bg-muted/20 px-3 py-3">
          <Input
            placeholder="New task"
            value={createDraft.title}
            onChange={(event) => {
              onClearError?.()
              setCreateDraft((current) => ({ ...current, title: event.target.value }))
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void handleCreate()
              }
              if (event.key === "Escape") {
                event.preventDefault()
                setCreateOpen(false)
                resetCreateDraft()
              }
            }}
            autoFocus
            className="h-8 border-0 border-b border-rule bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0"
          />
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
            <Input
              type="datetime-local"
              value={createDraft.deadline}
              onChange={(event) => setCreateDraft((current) => ({ ...current, deadline: event.target.value }))}
              className="num h-7 border-rule bg-transparent text-[11px]"
            />
            <Input
              placeholder="tag, tag"
              value={createDraft.tags}
              onChange={(event) => setCreateDraft((current) => ({ ...current, tags: event.target.value }))}
              className="h-7 border-rule bg-transparent text-[11px]"
            />
            <select
              value={createDraft.calendarId}
              onChange={(event) => setCreateDraft((current) => ({ ...current, calendarId: event.target.value }))}
              className="h-7 rounded-sm border border-rule bg-transparent px-2 text-[11px] text-foreground"
            >
              <option value="">No calendar</option>
              {calendars.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={() => {
                setCreateOpen(false)
                resetCreateDraft()
              }}
              className="flex h-6 items-center gap-1 rounded-sm px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={!createDraft.title.trim()}
              className="flex h-6 items-center gap-1 rounded-sm bg-copper px-2 text-[11px] text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              <Check className="h-3 w-3" /> Add
            </button>
          </div>
        </div>
      ) : null}

      <div className="relative mb-3">
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
            <span className="num text-[11px] font-medium uppercase text-muted-foreground">{searchResults.length}</span>
          </div>
          {searchResults.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">No tasks match “{query.trim()}”.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {searchResults.map((task, index) => renderTaskRow(task, index))}
            </ul>
          )}
        </div>
      ) : (
      <div className="flex flex-col gap-4">
        {actionableTasks.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            {liveTasks.length === 0 ? "No open tasks." : "Nothing open. Everything is scheduled."}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {actionableTasks.map((task, index) => renderTaskRow(task, index))}
          </ul>
        )}

        {scheduledTasks.length > 0 ? (
          <div>
            <button
              type="button"
              onClick={() => setShowScheduled((current) => !current)}
              className="flex items-center gap-2 py-1 text-left text-muted-foreground transition-colors hover:text-foreground"
              aria-expanded={showScheduled}
            >
              <h3 className="eyebrow">Scheduled</h3>
              <span className="num text-[11px] font-medium uppercase">{scheduledTasks.length}</span>
              {showScheduled ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {!showScheduled ? (
                <span className="text-[11px] normal-case text-muted-foreground/70">on your calendar</span>
              ) : null}
            </button>
            {showScheduled ? (
              <ul className="mt-1 flex flex-col gap-0.5">
                {scheduledTasks.map((task, index) => renderTaskRow(task, index))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div>
          <button
            type="button"
            onClick={() => setShowCompleted((current) => !current)}
            className="flex items-center gap-2 py-1 text-left text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={showCompleted}
          >
            <h3 className="eyebrow group-hover:text-foreground">Completed</h3>
            <span className="num text-[11px] font-medium uppercase">{completedTasks.length}</span>
            {showCompleted ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          {showCompleted ? (
            completedTasks.length === 0 ? (
              <p className="mt-2 text-[12.5px] text-muted-foreground">Nothing closed yet.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-0.5">
                {completedTasks.map((task, index) => renderTaskRow(task, index))}
              </ul>
            )
          ) : null}
        </div>
      </div>
      )}
    </RailSection>
  )
}
