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
  Tag,
  Trash2,
  X,
} from "lucide-react"

import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
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

function formatDeadlineShort(value: string | null) {
  if (!value) {
    return null
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function isTaskOverdue(task: Task, nowMs: number) {
  if (task.status === "missed") {
    return true
  }

  if (task.status === "completed" || !task.deadline) {
    return false
  }

  return new Date(task.deadline).getTime() < nowMs
}

function hasScheduledBlock(task: Task, scheduledTaskIds: Set<string>) {
  return task.status === "scheduled" || Boolean(task.scheduledFor) || scheduledTaskIds.has(task.id)
}

function compareTasks(left: Task, right: Task, taskIndex: Map<string, number>) {
  const leftDeadlineMs = left.deadline ? new Date(left.deadline).getTime() : Number.POSITIVE_INFINITY
  const rightDeadlineMs = right.deadline ? new Date(right.deadline).getTime() : Number.POSITIVE_INFINITY

  if (leftDeadlineMs !== rightDeadlineMs) {
    return leftDeadlineMs - rightDeadlineMs
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
  const [createOpen, setCreateOpen] = useState(false)
  const [createDraft, setCreateDraft] = useState<TaskDraft>(EMPTY_DRAFT)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<TaskDraft>(EMPTY_DRAFT)

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
  const defaultCalendarId = mode === "calendar" && calendar && calendar.id !== "cal-tasks" ? calendar.id : ""

  const filteredTasks = useMemo(() => {
    if (mode === "all") {
      return tasks
    }

    if (!calendar) {
      return []
    }

    if (calendar.id === "cal-tasks") {
      return tasks
    }

    return tasks.filter((task) => task.calendarId === calendar.id)
  }, [calendar, mode, tasks])

  const sortedTasks = useMemo(
    () => [...filteredTasks].sort((left, right) => compareTasks(left, right, taskIndex)),
    [filteredTasks, taskIndex],
  )

  const activeTasks = sortedTasks.filter((task) => task.status !== "completed")
  const completedTasks = sortedTasks.filter((task) => task.status === "completed")
  const overdueTasks = activeTasks.filter((task) => isTaskOverdue(task, nowMs))
  const unscheduledTasks = activeTasks.filter(
    (task) => !hasScheduledBlock(task, scheduledTaskIds) && !isTaskOverdue(task, nowMs),
  )
  const scheduledTasks = activeTasks.filter(
    (task) => hasScheduledBlock(task, scheduledTaskIds) && !isTaskOverdue(task, nowMs),
  )

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
    onClearError?.()
    const isScheduledTask = task.status === "scheduled" || Boolean(task.scheduledFor)

    if (isScheduledTask) {
      await onUpdateTask(task.id, {
        status: task.status === "completed" ? "completed" : "todo",
        scheduledFor: null,
      })
      return
    }

    await onDeleteTask(task.id)
  }

  const renderTaskRow = (task: Task, index: number) => {
    const isEditing = editingTaskId === task.id
    const isScheduledTask = hasScheduledBlock(task, scheduledTaskIds)
    const overdue = isTaskOverdue(task, nowMs)
    const calendarColor = calendars.find((c) => c.id === task.calendarId)?.color
    const deadlineLabel = formatDeadlineShort(task.deadline)

    if (isEditing) {
      return (
        <li
          key={task.id}
          className="border-b border-rule px-1 py-2"
        >
          <div className="space-y-2">
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
      <li
        key={task.id}
        className="group flex items-baseline gap-3 border-b border-rule px-1 py-2.5"
      >
        <span className="num w-6 shrink-0 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {String(index + 1).padStart(2, "0")}
        </span>
        <button
          type="button"
          onClick={() => void handleToggleComplete(task)}
          aria-label={task.status === "completed" ? "Mark todo" : "Mark complete"}
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors ${
            task.status === "completed"
              ? "border-copper bg-copper text-primary-foreground"
              : "border-rule-strong hover:border-foreground"
          }`}
        >
          {task.status === "completed" ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
        </button>
        <div className="min-w-0 flex-1">
          <p
            className={`text-[14px] leading-[1.4] ${
              task.status === "completed"
                ? "text-muted-foreground line-through"
                : "text-foreground"
            }`}
          >
            {task.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11.5px] text-muted-foreground">
            {overdue ? (
              <span className="num inline-flex items-center gap-1 font-medium uppercase tracking-[0.12em] text-destructive">
                <AlertCircle className="h-3 w-3" /> Overdue
              </span>
            ) : null}
            {isScheduledTask && !overdue && task.status !== "completed" ? (
              <span className="num inline-flex items-center gap-1 font-medium uppercase tracking-[0.12em] copper">
                Scheduled
              </span>
            ) : null}
            {deadlineLabel ? (
              <span className="num inline-flex items-center gap-1">
                <CalendarClock className="h-3 w-3" />
                {deadlineLabel}
              </span>
            ) : null}
            {calendarColor ? (
              <span className="inline-flex items-center gap-1">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: calendarColor }}
                  aria-hidden="true"
                />
                {calendars.find((c) => c.id === task.calendarId)?.name}
              </span>
            ) : null}
            {task.tags.length > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Tag className="h-3 w-3" />
                {task.tags.join(", ")}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
        </div>
      </li>
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

  const sections: { id: string; title: string; tasks: Task[] }[] = [
    { id: "overdue", title: "Overdue", tasks: overdueTasks },
    { id: "todo", title: "Todo", tasks: unscheduledTasks },
    { id: "scheduled", title: "Scheduled", tasks: scheduledTasks },
  ]

  return (
    <section className="flex flex-col">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="eyebrow">{headerTitle}</h2>
          <span className="num text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {activeTasks.length}
          </span>
        </div>
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
      </header>

      {errorMessage ? (
        <p className="mb-2 text-[12px] text-destructive">{errorMessage}</p>
      ) : null}

      {createOpen ? (
        <div className="mb-3 space-y-2 border-y border-rule py-2">
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

      <div className="space-y-5">
        {sections.map((section) => (
          <div key={section.id}>
            <div className="mb-1.5 flex items-baseline gap-2">
              <h3 className="eyebrow">{section.title}</h3>
              <span className="num text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {section.tasks.length}
              </span>
            </div>
            {section.tasks.length === 0 ? (
              <p className="border-b border-rule py-2.5 text-[12.5px] text-muted-foreground">
                {section.id === "overdue" ? "Nothing overdue." : section.id === "todo" ? "Inbox empty." : "Nothing scheduled."}
              </p>
            ) : (
              <ul>
                {section.tasks.map((task, index) => renderTaskRow(task, index))}
              </ul>
            )}
          </div>
        ))}

        <div>
          <button
            type="button"
            onClick={() => setShowCompleted((current) => !current)}
            className="flex items-center gap-2 py-1 text-left text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={showCompleted}
          >
            <h3 className="eyebrow group-hover:text-foreground">Completed</h3>
            <span className="num text-[11px] font-medium uppercase tracking-[0.14em]">
              {completedTasks.length}
            </span>
            {showCompleted ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
          {showCompleted ? (
            completedTasks.length === 0 ? (
              <p className="border-b border-rule py-2.5 text-[12.5px] text-muted-foreground">
                Nothing closed yet.
              </p>
            ) : (
              <ul>{completedTasks.map((task, index) => renderTaskRow(task, index))}</ul>
            )
          ) : null}
        </div>
      </div>
    </section>
  )
}
