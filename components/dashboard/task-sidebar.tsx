"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Plus,
  Check,
  Trash2,
  Calendar,
  ChevronDown,
  ChevronRight,
} from "lucide-react"
import {
  useCalendarStore,
  type CalendarTask,
} from "@/lib/stores/calendar-store"
import type { DashboardStats } from "@/types"

interface TaskItemProps {
  task: CalendarTask
  calendarColor: string
  onToggle: () => void
  onDelete: () => void
}

function TaskItem({ task, calendarColor, onToggle, onDelete }: TaskItemProps) {
  return (
    <div className="group flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-[#1f1f1f] transition-colors">
      <Checkbox
        checked={task.completed}
        onCheckedChange={onToggle}
        className="mt-0.5 border-[#3a3a3a] data-[state=checked]:border-transparent rounded-full"
        style={{
          backgroundColor: task.completed ? calendarColor : "transparent",
          borderColor: task.completed ? calendarColor : undefined,
        }}
      />
      <div className="flex-1 min-w-0">
        <p
          className={`text-[13px] leading-relaxed ${
            task.completed
              ? "text-muted-foreground line-through"
              : "text-foreground"
          }`}
        >
          {task.title}
        </p>
        {task.completedAt && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Completed {new Date(task.completedAt).toLocaleDateString()}
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 h-6 w-6 p-0 text-muted-foreground hover:text-red-400 hover:bg-transparent"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  )
}

interface StatusItemProps {
  label: string
  value: string | number
}

function StatusItem({ label, value }: StatusItemProps) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-foreground">{value}</p>
    </div>
  )
}

function formatCheckIns(value: DashboardStats["checkins"]) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

// Default status data
const mockStatusData = {
  checkIns: "Quiet",
  overdue: 0,
  unscheduled: 0,
  checkInsMessage: "No check-ins needed yet.",
  overdueMessage: "No overdue tasks.",
  estimatesMessage: "All tasks have an estimate or title duration hint.",
}

interface TaskSidebarProps {
  stats?: DashboardStats
}

export function TaskSidebar({ stats }: TaskSidebarProps) {
  const { calendars, activeCalendarId, tasks, addTask, toggleTaskCompletion, deleteTask, getTasksByCalendar } =
    useCalendarStore()

  const [newTaskTitle, setNewTaskTitle] = useState("")
  const [showCompleted, setShowCompleted] = useState(true)

  // Get active calendar
  const activeCalendar = activeCalendarId
    ? calendars.find((c) => c.id === activeCalendarId)
    : null

  // Get tasks for the active calendar
  const calendarTasks = activeCalendarId
    ? getTasksByCalendar(activeCalendarId)
    : { active: [], completed: [] }

  const handleAddTask = () => {
    if (newTaskTitle.trim() && activeCalendarId) {
      addTask(activeCalendarId, newTaskTitle.trim())
      setNewTaskTitle("")
    }
  }

  // Status calculation for right sidebar
  const status = stats
    ? {
        checkIns: formatCheckIns(stats.checkins),
        overdue: stats.overdue,
        unscheduled: stats.unscheduled,
        checkInsMessage: "Backend check-in state is connected to the dashboard mock endpoint.",
        overdueMessage:
          stats.overdue === 0 ? "No overdue tasks." : `${stats.overdue} tasks need attention.`,
        estimatesMessage:
          stats.unscheduled === 0
            ? "All tasks are currently scheduled."
            : `${stats.unscheduled} tasks are still waiting for a slot.`,
      }
    : mockStatusData

  // If no calendar is selected, show the default status panel
  if (!activeCalendar) {
    return (
      <div className="space-y-3">
        {/* Status Grid */}
        <Card className="bg-[#141414] border-[#2a2a2a]">
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs font-medium text-foreground">Status</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <StatusItem label="Check-ins" value={status.checkIns} />
              <StatusItem label="Overdue" value={status.overdue} />
              <StatusItem label="Unscheduled" value={status.unscheduled} />
            </div>
          </CardContent>
        </Card>

        {/* Check-ins */}
        <Card className="bg-[#141414] border-[#2a2a2a]">
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs font-medium text-foreground">Check-ins</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-2">
            <p className="text-[11px] text-muted-foreground">{status.checkInsMessage}</p>
          </CardContent>
        </Card>

        {/* Overdue */}
        <Card className="bg-[#141414] border-[#2a2a2a]">
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs font-medium text-foreground">Overdue</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-2">
            <p className="text-[11px] text-muted-foreground">{status.overdueMessage}</p>
          </CardContent>
        </Card>

        {/* Missing explicit estimates */}
        <Card className="bg-[#141414] border-[#2a2a2a]">
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-xs font-medium text-foreground">Missing explicit estimates</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-2">
            <p className="text-[11px] text-muted-foreground">{status.estimatesMessage}</p>
          </CardContent>
        </Card>

        {/* Hint to select a calendar */}
        <Card className="bg-[#141414]/50 border-[#2a2a2a] border-dashed">
          <CardContent className="p-4">
            <div className="flex flex-col items-center justify-center text-center gap-2">
              <Calendar className="w-8 h-8 text-muted-foreground/50" />
              <p className="text-[11px] text-muted-foreground">
                Select a calendar from the sidebar to manage its tasks
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Show task manager for selected calendar
  return (
    <div className="space-y-3 h-full flex flex-col">
      {/* Calendar Header */}
      <Card className="bg-[#141414] border-[#2a2a2a]">
        <CardHeader className="p-3 pb-2">
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: activeCalendar.color }}
            />
            <CardTitle className="text-sm font-semibold text-foreground">
              {activeCalendar.name}
            </CardTitle>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            {calendarTasks.active.length} active tasks
          </p>
        </CardHeader>
      </Card>

      {/* Task List */}
      <Card className="bg-[#141414] border-[#2a2a2a] flex-1 flex flex-col min-h-0">
        <CardHeader className="p-3 pb-2 flex-shrink-0">
          <CardTitle className="text-xs font-medium text-foreground flex items-center gap-2">
            <Check className="w-3.5 h-3.5" />
            Tasks
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0 flex-1 flex flex-col min-h-0">
          <ScrollArea className="flex-1 -mx-3">
            <div className="px-0 space-y-1">
              {/* Active Tasks */}
              {calendarTasks.active.length === 0 ? (
                <div className="px-3 py-4 text-center">
                  <p className="text-[11px] text-muted-foreground">
                    No active tasks. Add one below!
                  </p>
                </div>
              ) : (
                calendarTasks.active.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    calendarColor={activeCalendar.color}
                    onToggle={() => toggleTaskCompletion(task.id)}
                    onDelete={() => deleteTask(task.id)}
                  />
                ))
              )}

              {/* Completed Section */}
              {calendarTasks.completed.length > 0 && (
                <div className="pt-2">
                  <button
                    onClick={() => setShowCompleted(!showCompleted)}
                    className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-full"
                  >
                    {showCompleted ? (
                      <ChevronDown className="w-3 h-3" />
                    ) : (
                      <ChevronRight className="w-3 h-3" />
                    )}
                    Completed ({calendarTasks.completed.length})
                  </button>
                  {showCompleted && (
                    <div className="space-y-1 mt-1">
                      {calendarTasks.completed.map((task) => (
                        <TaskItem
                          key={task.id}
                          task={task}
                          calendarColor={activeCalendar.color}
                          onToggle={() => toggleTaskCompletion(task.id)}
                          onDelete={() => deleteTask(task.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Add Task Input */}
          <div className="pt-3 mt-auto border-t border-[#2a2a2a] flex-shrink-0">
            <div className="flex gap-2">
              <Input
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                placeholder="Add a new task..."
                className="flex-1 bg-[#0a0a0a] border-[#2a2a2a] text-foreground placeholder:text-muted-foreground text-[12px] h-8"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddTask()
                }}
              />
              <Button
                onClick={handleAddTask}
                disabled={!newTaskTitle.trim()}
                size="sm"
                className="h-8 px-3 bg-[#3b82f6] text-white hover:bg-[#2563eb] disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
