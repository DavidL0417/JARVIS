"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Plus, Check, ChevronDown, ChevronUp } from "lucide-react"
import type { Calendar } from "./calendars-sidebar"

// Task interface
export interface Task {
  id: string
  calendarId: string
  title: string
  isCompleted: boolean
  createdAt: string
  completedAt?: string
}

// API Hook: Replace mockTasks with useTasks(calendarId) hook
// Example: const { data: tasks, mutate } = useSWR(`/api/calendars/${calendarId}/tasks`, fetcher)
const initialTasks: Task[] = [
  { id: "task-1", calendarId: "cal-1", title: "Review lecture notes", isCompleted: false, createdAt: "2026-04-10T10:00:00" },
  { id: "task-2", calendarId: "cal-1", title: "Call mom", isCompleted: true, createdAt: "2026-04-09T10:00:00", completedAt: "2026-04-10T14:00:00" },
  { id: "task-3", calendarId: "cal-2", title: "Submit expense report", isCompleted: false, createdAt: "2026-04-08T10:00:00" },
  { id: "task-4", calendarId: "cal-2", title: "Team standup prep", isCompleted: true, createdAt: "2026-04-07T10:00:00", completedAt: "2026-04-08T09:00:00" },
  { id: "task-5", calendarId: "cal-3", title: "Read Chapter 5 - MATH 240", isCompleted: false, createdAt: "2026-04-10T08:00:00" },
  { id: "task-6", calendarId: "cal-3", title: "Problem Set 3", isCompleted: false, createdAt: "2026-04-09T08:00:00" },
  { id: "task-7", calendarId: "cal-4", title: "Update project timeline", isCompleted: false, createdAt: "2026-04-10T12:00:00" },
  { id: "task-8", calendarId: "cal-4", title: "Review PR #42", isCompleted: true, createdAt: "2026-04-08T12:00:00", completedAt: "2026-04-09T16:00:00" },
]

interface TaskManagerProps {
  calendar: Calendar | null
  tasks: Task[]
  onTasksChange: (tasks: Task[]) => void
}

export function TaskManager({ calendar, tasks, onTasksChange }: TaskManagerProps) {
  const [newTaskTitle, setNewTaskTitle] = useState("")
  const [showCompleted, setShowCompleted] = useState(true)

  // Filter tasks for the active calendar
  const calendarTasks = calendar 
    ? tasks.filter(task => task.calendarId === calendar.id)
    : []
  
  const activeTasks = calendarTasks.filter(task => !task.isCompleted)
  const completedTasks = calendarTasks.filter(task => task.isCompleted)

  // API Hook: Replace with createTask mutation
  const handleAddTask = () => {
    if (!newTaskTitle.trim() || !calendar) return
    const newTask: Task = {
      id: `task-${Date.now()}`,
      calendarId: calendar.id,
      title: newTaskTitle.trim(),
      isCompleted: false,
      createdAt: new Date().toISOString(),
    }
    onTasksChange([...tasks, newTask])
    setNewTaskTitle("")
  }

  // API Hook: Replace with updateTask mutation
  const handleToggleTask = (taskId: string) => {
    const updated = tasks.map(task => {
      if (task.id === taskId) {
        return {
          ...task,
          isCompleted: !task.isCompleted,
          completedAt: !task.isCompleted ? new Date().toISOString() : undefined,
        }
      }
      return task
    })
    onTasksChange(updated)
  }

  // API Hook: Replace with deleteTask mutation
  const handleDeleteTask = (taskId: string) => {
    const updated = tasks.filter(task => task.id !== taskId)
    onTasksChange(updated)
  }

  // Show placeholder when no calendar is selected
  if (!calendar) {
    return (
      <div className="space-y-3">
        <Card className="bg-card border-border">
          <CardHeader className="p-3 pb-1">
            <CardTitle className="text-sm font-bold text-foreground">Tasks</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-2">
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center mb-3">
                <Check className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-semibold text-muted-foreground">No Calendar Selected</p>
              <p className="text-xs text-muted-foreground mt-1 font-medium">
                Click on a calendar in the sidebar to view its tasks
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Calendar Header */}
      <Card className="bg-card border-border">
        <CardHeader className="p-3 pb-1">
          <div className="flex items-center gap-2">
            <div 
              className="w-3 h-3 rounded-full flex-shrink-0" 
              style={{ backgroundColor: calendar.color }}
            />
            <CardTitle className="text-sm font-bold text-foreground truncate">
              {calendar.name} Tasks
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-3 pt-2">
          {/* Add Task Input */}
          <div className="flex gap-2">
            <Input
              placeholder="Add a new task..."
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddTask()}
              className="flex-1 h-8 text-sm"
            />
            <Button
              size="sm"
              onClick={handleAddTask}
              disabled={!newTaskTitle.trim()}
              className="h-8 px-3"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Active Tasks */}
      <Card className="bg-card border-border">
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-sm font-bold text-foreground">
            Active Tasks ({activeTasks.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-2">
          {activeTasks.length === 0 ? (
            <p className="text-xs text-muted-foreground font-medium py-2">
              No active tasks. Add one above!
            </p>
          ) : (
            <div className="space-y-1">
              {activeTasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center gap-2 p-2 rounded-lg hover:bg-secondary/50 transition-colors group"
                >
                  <Checkbox
                    checked={task.isCompleted}
                    onCheckedChange={() => handleToggleTask(task.id)}
                    className="border-2"
                    style={{ borderColor: calendar.color }}
                  />
                  <span className="flex-1 text-sm font-medium text-foreground">
                    {task.title}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteTask(task.id)}
                    className="h-6 w-6 p-0 opacity-0 group-hover:opacity-60 hover:opacity-100 text-red-500"
                  >
                    ×
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Completed Tasks */}
      <Card className="bg-card border-border">
        <CardHeader className="p-3 pb-1">
          <button 
            className="flex items-center justify-between w-full"
            onClick={() => setShowCompleted(!showCompleted)}
          >
            <CardTitle className="text-sm font-bold text-foreground">
              Completed ({completedTasks.length})
            </CardTitle>
            {showCompleted ? (
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
        </CardHeader>
        {showCompleted && (
          <CardContent className="p-3 pt-2">
            {completedTasks.length === 0 ? (
              <p className="text-xs text-muted-foreground font-medium py-2">
                No completed tasks yet.
              </p>
            ) : (
              <div className="space-y-1">
                {completedTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2 p-2 rounded-lg hover:bg-secondary/50 transition-colors group"
                  >
                    <Checkbox
                      checked={task.isCompleted}
                      onCheckedChange={() => handleToggleTask(task.id)}
                      className="border-2"
                      style={{ borderColor: calendar.color, backgroundColor: calendar.color }}
                    />
                    <span className="flex-1 text-sm font-medium text-muted-foreground line-through">
                      {task.title}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteTask(task.id)}
                      className="h-6 w-6 p-0 opacity-0 group-hover:opacity-60 hover:opacity-100 text-red-500"
                    >
                      ×
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  )
}

// Export initial tasks for use in page
export { initialTasks }
