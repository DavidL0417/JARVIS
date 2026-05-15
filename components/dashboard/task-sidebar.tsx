"use client"

import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react"

import { getTaskScheduleActionLabel } from "@/lib/task-schedule-state"
import { TASKS_CALENDAR_ID, TASKS_CALENDAR_NAME } from "@/lib/task-calendar-constants"
import type { CreateTaskRequest, ScheduleEvent, Task, UpdateTaskRequest } from "@/types"

interface TaskSidebarProps {
  tasks: Task[]
  scheduleEvents: ScheduleEvent[]
  errorMessage?: string | null
  onClearError?: () => void
  onCreateTask: (input: CreateTaskRequest) => Promise<void> | void
  onUpdateTask: (taskId: string, input: UpdateTaskRequest) => Promise<void> | void
  onDeleteTask: (taskId: string) => Promise<void> | void
  onScheduleTask: (taskId: string) => Promise<void> | void
}

type CreateDraft = {
  title: string
  deadline: string
}

type EditDraft = {
  priority: Task["priority"]
  isImmutable: boolean
}

const EMPTY_CREATE_DRAFT: CreateDraft = {
  title: "",
  deadline: "",
}

function toIsoDateTime(value: string) {
  return value ? new Date(value).toISOString() : null
}

function formatDeadline(value: string | null) {
  if (!value) {
    return "No deadline"
  }

  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function formatStatus(task: Task) {
  if (task.status === "completed") {
    return "Completed"
  }

  if (task.status === "scheduled" && task.scheduledFor) {
    return `Scheduled ${new Date(task.scheduledFor).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    })}`
  }

  if (task.status === "missed") {
    return "Missed"
  }

  return "Unscheduled"
}

function getStatusBadgeVariant(task: Task) {
  if (task.status === "completed") {
    return "secondary" as const
  }

  if (task.status === "missed") {
    return "destructive" as const
  }

  if (task.status === "scheduled") {
    return "default" as const
  }

  return "outline" as const
}

export function TaskSidebar({
  tasks,
  scheduleEvents,
  errorMessage,
  onClearError,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onScheduleTask,
}: TaskSidebarProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [createDraft, setCreateDraft] = useState<CreateDraft>(EMPTY_CREATE_DRAFT)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null)
  const [mutatingTaskId, setMutatingTaskId] = useState<string | null>(null)

  const tcTasks = useMemo(() => {
    return [...tasks]
      .filter((task) => task.calendarId === TASKS_CALENDAR_ID)
      .sort((left, right) => {
        const leftDeadline = left.deadline ? new Date(left.deadline).getTime() : Number.POSITIVE_INFINITY
        const rightDeadline = right.deadline ? new Date(right.deadline).getTime() : Number.POSITIVE_INFINITY
        return leftDeadline - rightDeadline
      })
  }, [tasks])

  const handleCreateTask = async () => {
    if (!createDraft.title.trim()) {
      return
    }

    onClearError?.()
    setMutatingTaskId("create")

    try {
      await onCreateTask({
        title: createDraft.title.trim(),
        deadline: toIsoDateTime(createDraft.deadline),
        calendarId: TASKS_CALENDAR_ID,
      })
      setCreateDraft(EMPTY_CREATE_DRAFT)
      setIsCreateOpen(false)
    } finally {
      setMutatingTaskId(null)
    }
  }

  const handleStartEdit = (task: Task) => {
    setEditingTaskId(task.id)
    setEditDraft({
      priority: task.priority,
      isImmutable: task.isImmutable,
    })
  }

  const handleSaveTask = async (taskId: string) => {
    if (!editDraft) {
      return
    }

    onClearError?.()
    setMutatingTaskId(taskId)

    try {
      await onUpdateTask(taskId, {
        priority: editDraft.priority,
        isImmutable: editDraft.isImmutable,
      })
      setEditingTaskId(null)
      setEditDraft(null)
    } finally {
      setMutatingTaskId(null)
    }
  }

  const handleSchedule = async (taskId: string) => {
    onClearError?.()
    setMutatingTaskId(taskId)

    try {
      await onScheduleTask(taskId)
    } finally {
      setMutatingTaskId(null)
    }
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

      <Card className="border-border bg-card">
        <CardHeader className="p-3 pb-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm font-bold text-foreground">Calendar Tasks</CardTitle>
              <p className="mt-1 text-[11px] font-medium text-muted-foreground">
                {TASKS_CALENDAR_NAME} keeps a narrow due-date strip until Claude places a work block.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => setIsCreateOpen((current) => !current)}
              className="h-8 bg-[#f9a8d4] px-3 text-xs font-semibold text-slate-900 hover:bg-[#f472b6]"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add
            </Button>
          </div>
        </CardHeader>
        {isCreateOpen ? (
          <CardContent className="space-y-2 p-3 pt-0">
            <Input
              placeholder="Task title"
              value={createDraft.title}
              onChange={(event) => setCreateDraft((current) => ({ ...current, title: event.target.value }))}
              className="h-8 text-sm"
            />
            <Input
              type="datetime-local"
              value={createDraft.deadline}
              onChange={(event) => setCreateDraft((current) => ({ ...current, deadline: event.target.value }))}
              className="h-8 text-xs"
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsCreateOpen(false)
                  setCreateDraft(EMPTY_CREATE_DRAFT)
                }}
                className="h-8 text-xs font-semibold"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void handleCreateTask()}
                disabled={!createDraft.title.trim() || mutatingTaskId === "create"}
                className="h-8 bg-[#93c5fd] px-3 text-xs font-semibold text-slate-900 hover:bg-[#60a5fa]"
              >
                {mutatingTaskId === "create" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                Save Task
              </Button>
            </div>
          </CardContent>
        ) : null}
      </Card>

      <Card className="border-border bg-card">
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-sm font-bold text-foreground">Task Calendar Queue ({tcTasks.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 p-3 pt-2">
          {tcTasks.length === 0 ? (
            <p className="py-6 text-center text-xs font-medium text-muted-foreground">
              No Task Calendar items yet.
            </p>
          ) : (
            tcTasks.map((task) => {
              const isEditing = editingTaskId === task.id
              const scheduleLabel = getTaskScheduleActionLabel(task, scheduleEvents)
              const isBusy = mutatingTaskId === task.id

              return (
                <div
                  key={task.id}
                  onClick={() => {
                    if (!isEditing) {
                      handleStartEdit(task)
                    }
                  }}
                  className="w-full rounded-2xl border border-[#fbcfe8]/60 bg-gradient-to-r from-[#fdf2f8] to-[#eff6ff] p-3 text-left shadow-sm transition-transform hover:-translate-y-0.5 dark:border-[#3f3141] dark:from-[#2c1626] dark:to-[#1d2436]"
                >
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{task.title}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge variant={getStatusBadgeVariant(task)}>{task.status}</Badge>
                        <Badge variant="outline">{task.priority}</Badge>
                        {task.isImmutable ? <Badge variant="outline">Immutable</Badge> : null}
                      </div>
                    </div>

                    <div className="space-y-1 text-xs font-medium text-muted-foreground">
                      <p>Deadline</p>
                      <p className="text-foreground">{formatDeadline(task.deadline)}</p>
                      <p>Status</p>
                      <p className="text-foreground">{formatStatus(task)}</p>
                    </div>

                    <div className="flex items-start justify-end gap-2">
                      <Button
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          void handleSchedule(task.id)
                        }}
                        disabled={isBusy}
                        className="h-8 bg-[#a7f3d0] px-3 text-xs font-semibold text-slate-900 hover:bg-[#6ee7b7]"
                      >
                        {isBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                        {scheduleLabel}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          handleStartEdit(task)
                        }}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          void onDeleteTask(task.id)
                        }}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {isEditing && editDraft ? (
                    <div
                      className="mt-3 rounded-xl border border-border/60 bg-background/80 p-3"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="space-y-1 text-xs font-semibold text-muted-foreground">
                          <span>Priority</span>
                          <select
                            value={editDraft.priority}
                            onChange={(event) =>
                              setEditDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      priority: event.target.value as Task["priority"],
                                    }
                                  : current,
                              )
                            }
                            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
                          >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                          </select>
                        </label>

                        <label className="flex items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-xs font-semibold text-foreground">
                          <span>Immutable</span>
                          <Checkbox
                            checked={editDraft.isImmutable}
                            onCheckedChange={(checked) =>
                              setEditDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      isImmutable: checked === true,
                                    }
                                  : current,
                              )
                            }
                          />
                        </label>
                      </div>

                      <div className="mt-3 flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingTaskId(null)
                            setEditDraft(null)
                          }}
                          className="h-8 text-xs font-semibold"
                        >
                          <X className="mr-1 h-3.5 w-3.5" />
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => void handleSaveTask(task.id)}
                          disabled={isBusy}
                          className="h-8 bg-[#93c5fd] px-3 text-xs font-semibold text-slate-900 hover:bg-[#60a5fa]"
                        >
                          {isBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}
