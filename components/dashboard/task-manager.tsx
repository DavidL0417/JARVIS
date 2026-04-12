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
import type { CreateTaskRequest, Task, UpdateTaskRequest } from "@/types"

type TaskManagerMode = "all" | "calendar"

interface TaskManagerProps {
  mode?: TaskManagerMode
  calendar?: Calendar | null
  calendars: Calendar[]
  tasks: Task[]
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
    (task) => task.status === "todo" && !isTaskOverdue(task, nowMs),
  )
  const scheduledTasks = activeTasks.filter(
    (task) => task.status === "scheduled" && !isTaskOverdue(task, nowMs),
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

  const renderTaskRow = (task: Task) => {
    const isEditing = editingTaskId === task.id

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
                  <Badge variant={getStatusBadgeVariant(task, nowMs)}>{getStatusLabel(task, nowMs)}</Badge>
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
                  onClick={() => void onDeleteTask(task.id)}
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
                >
                  <Trash2 className="h-3.5 w-3.5" />
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
    <div className="space-y-3">
      {errorMessage ? (
        <Card className="border-red-500/40 bg-red-500/10">
          <CardContent className="p-3">
            <p className="text-xs font-medium text-red-300">{errorMessage}</p>
          </CardContent>
        </Card>
      ) : null}

      <Card className="bg-card border-border">
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-sm font-bold text-foreground">{headerTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 p-3 pt-2">
          <Input
            placeholder="Add a task title..."
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
          <div className="grid grid-cols-1 gap-2">
            <Input
              type="datetime-local"
              value={createDraft.deadline}
              onChange={(event) => setCreateDraft((current) => ({ ...current, deadline: event.target.value }))}
              className="h-8 text-xs"
            />
            <Input
              placeholder="Tags (comma separated)"
              value={createDraft.tags}
              onChange={(event) => setCreateDraft((current) => ({ ...current, tags: event.target.value }))}
              className="h-8 text-xs"
            />
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
          </div>
          <Button
            size="sm"
            onClick={() => void handleCreate()}
            disabled={!createDraft.title.trim()}
            className="h-8 w-full bg-[#3b82f6] text-xs font-semibold text-white hover:bg-[#2563eb]"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add Task
          </Button>
        </CardContent>
      </Card>

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
          empty: "No unscheduled todo tasks.",
        },
        {
          id: "scheduled",
          title: "Scheduled Upcoming",
          tasks: scheduledTasks,
          empty: "No scheduled tasks yet.",
        },
      ].map((section) => (
        <Card key={section.id} className="bg-card border-border">
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-sm font-bold text-foreground">
              {section.title} ({section.tasks.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-3 pt-2">
            {section.tasks.length === 0 ? (
              <p className="py-2 text-xs font-medium text-muted-foreground">{section.empty}</p>
            ) : (
              section.tasks.map(renderTaskRow)
            )}
          </CardContent>
        </Card>
      ))}

      <Card className="bg-card border-border">
        <CardHeader className="p-3 pb-1">
          <button
            className="flex w-full items-center justify-between"
            onClick={() => setShowCompleted((current) => !current)}
          >
            <CardTitle className="text-sm font-bold text-foreground">
              Completed ({completedTasks.length})
            </CardTitle>
            {showCompleted ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </CardHeader>
        {showCompleted ? (
          <CardContent className="space-y-2 p-3 pt-2">
            {completedTasks.length === 0 ? (
              <p className="py-2 text-xs font-medium text-muted-foreground">No completed tasks yet.</p>
            ) : (
              completedTasks.map(renderTaskRow)
            )}
          </CardContent>
        ) : null}
      </Card>
    </div>
  )
}
