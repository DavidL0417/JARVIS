"use client"

import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react"
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

function formatDeadlineLabel(value: string | null) {
  if (!value) {
    return "No deadline"
  }

  return `Due ${value.slice(0, 16).replace("T", " ")}`
}

function getStatusBadgeVariant(task: Task, nowMs: number) {
  if (isTaskOverdue(task, nowMs)) {
    return "destructive" as const
  }

  const status = task.status

  if (status === "completed") {
    return "secondary" as const
  }

  if (status === "missed") {
    return "destructive" as const
  }

  if (status === "scheduled") {
    return "default" as const
  }

  return "outline" as const
}

function getStatusLabel(task: Task, nowMs: number) {
  if (isTaskOverdue(task, nowMs)) {
    return task.status === "missed" ? "Missed" : "Overdue"
  }

  if (task.status === "scheduled" && task.scheduledFor) {
    return `Scheduled ${task.scheduledFor.slice(0, 16).replace("T", " ")}`
  }

  if (task.status === "completed") {
    return "Completed"
  }

  return "Todo"
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

function compareTasks(left: Task, right: Task, nowMs: number, taskIndex: Map<string, number>) {
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
  const [showCompleted, setShowCompleted] = useState(true)
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
    () => [...filteredTasks].sort((left, right) => compareTasks(left, right, nowMs, taskIndex)),
    [filteredTasks, nowMs, taskIndex],
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

  const headerTitle =
    mode === "all" ? "Tasks" : calendar ? `${calendar.name} Tasks` : "Tasks"

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

  const renderTaskRow = (task: Task) => {
    const isEditing = editingTaskId === task.id
    const isScheduledTask = hasScheduledBlock(task, scheduledTaskIds)
    const statusBadge =
      isScheduledTask && task.status !== "completed" && task.status !== "missed"
        ? "Scheduled"
        : getStatusLabel(task, nowMs)

    return (
      <div
        key={task.id}
        className="rounded-lg border border-border/60 bg-secondary/20 p-2.5 transition-colors hover:bg-secondary/35"
      >
        <div className="flex items-start gap-2">
          <Checkbox
            checked={task.status === "completed"}
            onCheckedChange={() => void handleToggleComplete(task)}
            className="mt-1 border-2"
          />
          <div className="min-w-0 flex-1 space-y-1.5">
            {isEditing ? (
              <div className="space-y-2">
                <Input
                  value={editDraft.title}
                  onChange={(event) => setEditDraft((current) => ({ ...current, title: event.target.value }))}
                  className="h-8 text-sm"
                />
                <div className="grid grid-cols-1 gap-2">
                  <Input
                    type="datetime-local"
                    value={editDraft.deadline}
                    onChange={(event) => setEditDraft((current) => ({ ...current, deadline: event.target.value }))}
                    className="h-8 text-xs"
                  />
                  <Input
                    value={editDraft.tags}
                    onChange={(event) => setEditDraft((current) => ({ ...current, tags: event.target.value }))}
                    placeholder="tag1, tag2"
                    className="h-8 text-xs"
                  />
                  <select
                    value={editDraft.calendarId}
                    onChange={(event) => setEditDraft((current) => ({ ...current, calendarId: event.target.value }))}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                  >
                    <option value="">No calendar</option>
                    {calendars.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm font-semibold text-foreground">{task.title}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={getStatusBadgeVariant(isScheduledTask && task.status === "todo" ? { ...task, status: "scheduled" } : task, nowMs)}>
                    {statusBadge}
                  </Badge>
                  {task.allDay ? <Badge variant="outline">All day</Badge> : null}
                  <Badge variant="outline">{formatDeadlineLabel(task.deadline)}</Badge>
                  {task.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {isEditing ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleSaveEdit(task.id)}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                >
                  <Save className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingTaskId(null)}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleStartEditing(task)}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleRemoveTask(task)}
                  title={isScheduledTask ? "Unschedule task" : "Delete task"}
                  aria-label={isScheduledTask ? "Unschedule task" : "Delete task"}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
                >
                  {isScheduledTask ? <X className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (mode === "calendar" && !calendar) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-sm font-bold text-foreground">Tasks</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-2">
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/50">
              <CalendarIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-semibold text-muted-foreground">No Calendar Selected</p>
            <p className="text-xs font-medium text-muted-foreground">
              Click a calendar in the sidebar to filter its tasks.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader className="p-3 pb-1">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm font-semibold text-foreground">{headerTitle}</CardTitle>
          <div className="rounded-md border border-border bg-surface-subtle px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {activeTasks.length} active
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-3 pt-2">
        {errorMessage ? (
          <div className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2">
            <p className="text-xs font-medium text-destructive">{errorMessage}</p>
          </div>
        ) : null}

        <div className="space-y-2 rounded-md border border-border bg-surface-subtle p-2">
          <Input
            placeholder="Task title"
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
            }}
            className="h-8 text-sm"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.75fr)]">
            <Input
              type="datetime-local"
              value={createDraft.deadline}
              onChange={(event) => setCreateDraft((current) => ({ ...current, deadline: event.target.value }))}
              className="h-8 text-xs"
            />
            <Input
              placeholder="Tags"
              value={createDraft.tags}
              onChange={(event) => setCreateDraft((current) => ({ ...current, tags: event.target.value }))}
              className="h-8 text-xs"
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <select
              value={createDraft.calendarId}
              onChange={(event) => setCreateDraft((current) => ({ ...current, calendarId: event.target.value }))}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
            >
              <option value="">No calendar</option>
              {calendars.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={() => void handleCreate()}
              disabled={!createDraft.title.trim()}
              className="h-8 text-xs font-semibold"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add Task
            </Button>
          </div>
        </div>

        {[
          {
            id: "overdue",
            title: "Overdue / Missed",
            tasks: overdueTasks,
            empty: "No overdue tasks.",
          },
          {
            id: "todo",
            title: "Unscheduled Todo",
            tasks: unscheduledTasks,
            empty: "No unscheduled tasks.",
          },
          {
            id: "scheduled",
            title: "Scheduled",
            tasks: scheduledTasks,
            empty: "No scheduled tasks yet.",
          },
        ].map((section) => (
          <section key={section.id} className="space-y-2">
            <div className="flex items-center justify-between gap-3 border-b border-border pb-1">
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {section.title}
              </h3>
              <span className="text-xs font-semibold text-foreground">{section.tasks.length}</span>
            </div>
            {section.tasks.length === 0 ? (
              <p className="py-2 text-xs font-medium text-muted-foreground">{section.empty}</p>
            ) : (
              section.tasks.map(renderTaskRow)
            )}
          </section>
        ))}

        <section className="space-y-2">
          <button
            className="flex w-full items-center justify-between border-b border-border pb-1 text-left"
            onClick={() => setShowCompleted((current) => !current)}
          >
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Completed
            </span>
            {showCompleted ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {showCompleted ? (
            <div className="space-y-2">
            {completedTasks.length === 0 ? (
              <p className="py-2 text-xs font-medium text-muted-foreground">No completed tasks yet.</p>
            ) : (
              completedTasks.map(renderTaskRow)
            )}
            </div>
          ) : null}
        </section>
      </CardContent>
    </Card>
  )
}
