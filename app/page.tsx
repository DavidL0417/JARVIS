"use client"

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { WorkspaceSnapshot } from "@/components/dashboard/workspace-snapshot"
import { PanelTabs, type PanelTabId } from "@/components/dashboard/panel-tabs"
import { MasterInput } from "@/components/dashboard/master-input"
import { WhatToDoNow } from "@/components/dashboard/what-to-do-now"
import { StatusPanel } from "@/components/dashboard/status-panel"
import { CalendarsSidebar, initialCalendars, type Calendar } from "@/components/dashboard/calendars-sidebar"
import { TaskManager } from "@/components/dashboard/task-manager"
import { APP_CALENDAR_PRESET_MAP } from "@/lib/calendar-config"
import { X, Book } from "lucide-react"
// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER
import { getDashboardData } from "@/lib/data/dashboard"
import type {
  CreateTaskRequest,
  DashboardResponse,
  DeleteTaskResponse,
  ScheduleEvent,
  ScheduleEventInput,
  ScheduleResponse,
  Task,
  TaskMutationResponse,
  UpdateTaskRequest,
} from "@/types"
// ##### END BACKEND #####

type MobileSection = "command" | "schedule" | "status"
type PlannerUiStatus = "Not scheduled" | "Scheduling..." | "Ready" | "Error"

const ScheduleView = dynamic(
  () => import("@/components/dashboard/schedule-view").then((module) => module.ScheduleView),
  { ssr: false },
)

const CALENDAR_DEFAULTS: Record<string, { name: string; color: string; source: Calendar["source"] }> =
  APP_CALENDAR_PRESET_MAP

const DEFAULT_BACKEND_CALENDAR_ID = "calendar-main"
const FALLBACK_USER_ID = "00000000-0000-4000-8000-000000000000"
const DASHBOARD_REFRESH_EVENT = "jarvis-dashboard-refresh"

function getDisplayCalendarId(calendarId: string | null | undefined) {
  return calendarId || DEFAULT_BACKEND_CALENDAR_ID
}

function createCalendarFromId(calendarId: string): Calendar {
  const preset = CALENDAR_DEFAULTS[calendarId]

  if (preset) {
    return {
      id: calendarId,
      name: preset.name,
      color: preset.color,
      isVisible: true,
      source: preset.source,
    }
  }

  return {
    id: calendarId,
    name: calendarId.replace(/[-_]/g, " "),
    color: "#a78bfa",
    isVisible: true,
    source: "local",
  }
}

function mergeScheduleEvents(baseEvents: ScheduleEvent[], overlayEvents: ScheduleEvent[]) {
  if (overlayEvents.length === 0) {
    return baseEvents
  }

  const filteredBaseEvents = baseEvents.filter((baseEvent) => {
    return !overlayEvents.some((overlayEvent) => {
      if (overlayEvent.id === baseEvent.id) {
        return true
      }

      if (overlayEvent.taskId && baseEvent.taskId) {
        return overlayEvent.taskId === baseEvent.taskId
      }

      return false
    })
  })

  return [...filteredBaseEvents, ...overlayEvents].sort(
    (left, right) => new Date(left.start).getTime() - new Date(right.start).getTime(),
  )
}

function toScheduleEventInput(event: ScheduleEvent): ScheduleEventInput {
  return {
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    source: event.source,
    taskId: event.taskId,
    status: event.status,
    location: event.location,
    externalEventId: event.externalEventId,
    isImmutable: event.isImmutable,
    allDay: event.allDay,
    calendarId: event.calendarId,
  }
}

function getApiErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const details = "details" in payload && typeof payload.details === "string" ? payload.details : null
    const error = "error" in payload && typeof payload.error === "string" ? payload.error : null

    if (details) {
      return details
    }

    if (error) {
      return error
    }
  }

  return fallback
}

function buildOptimisticTask(userId: string, input: CreateTaskRequest): Task {
  return {
    id: crypto.randomUUID(),
    userId,
    title: input.title,
    description: input.description ?? null,
    deadline: input.deadline ?? null,
    durationMinutes: input.durationMinutes ?? null,
    priority: input.priority ?? "medium",
    status: input.status ?? "todo",
    scheduledFor: input.scheduledFor ?? null,
    isImmutable: input.isImmutable ?? false,
    allDay: input.allDay ?? false,
    calendarId: input.calendarId ?? null,
    tags: input.tags ?? [],
  }
}

function mergeTaskUpdate(task: Task, update: UpdateTaskRequest): Task {
  return {
    ...task,
    title: update.title ?? task.title,
    description: update.description !== undefined ? update.description : task.description,
    deadline: update.deadline !== undefined ? update.deadline : task.deadline,
    durationMinutes:
      update.durationMinutes !== undefined ? update.durationMinutes : task.durationMinutes,
    priority: update.priority ?? task.priority,
    status: update.status ?? task.status,
    scheduledFor:
      update.scheduledFor !== undefined
        ? update.scheduledFor
        : update.status === "completed"
          ? null
          : task.scheduledFor,
    isImmutable: update.isImmutable ?? task.isImmutable,
    allDay: update.allDay ?? task.allDay,
    calendarId: update.calendarId !== undefined ? update.calendarId : task.calendarId,
    tags: update.tags ?? task.tags,
  }
}

function applyScheduleToTasks(tasks: Task[], schedule: ScheduleResponse["schedule"]): Task[] {
  const plannedTaskEvents = new Map(
    schedule.proposedEvents
      .filter((event) => event.source === "task" && event.taskId)
      .map((event) => [event.taskId as string, event]),
  )
  const unscheduledTaskIds = new Set(schedule.unscheduledTaskIds)

  return tasks.map((task): Task => {
    const plannedEvent = plannedTaskEvents.get(task.id)

    if (plannedEvent) {
      return {
        ...task,
        status: "scheduled",
        scheduledFor: plannedEvent.start,
      }
    }

    if (unscheduledTaskIds.has(task.id) && task.status !== "completed" && task.status !== "missed") {
      return {
        ...task,
        status: "todo",
        scheduledFor: null,
      }
    }

    return task
  })
}

function getCurrentUserId(tasks: Task[], dashboardData: DashboardResponse | null) {
  return tasks[0]?.userId || dashboardData?.events[0]?.userId || FALLBACK_USER_ID
}

function PanelPlaceholder({
  title,
  message,
}: {
  title: string
  message: string
}) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="p-3 pb-1">
        <CardTitle className="text-sm font-bold text-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-2">
        <p className="text-xs font-medium text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  )
}

export default function DashboardPage() {
  const [rightColumnOpen, setRightColumnOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mobileSection, setMobileSection] = useState<MobileSection>("schedule")
  const [isDarkMode, setIsDarkMode] = useState(true)
  const [activePanelTab, setActivePanelTab] = useState<PanelTabId>("focus")
  
  // Calendar management state
  const [calendarsSidebarOpen, setCalendarsSidebarOpen] = useState(false)
  const [calendars, setCalendars] = useState<Calendar[]>(initialCalendars)
  const [activeCalendarId, setActiveCalendarId] = useState<string | null>(null)
  
  // Task management state
  const [tasks, setTasks] = useState<Task[]>([])
  const [taskErrorMessage, setTaskErrorMessage] = useState("")

  // ##### BACKEND API #####
  // DO NOT MODIFY UNLESS BACKEND OWNER
  const [dashboardData, setDashboardData] = useState<DashboardResponse | null>(null)
  const [scheduledOverlayEvents, setScheduledOverlayEvents] = useState<ScheduleEvent[]>([])
  const [plannerStatus, setPlannerStatus] = useState<PlannerUiStatus>("Not scheduled")
  const [plannerSummary, setPlannerSummary] = useState("")
  const [isScheduling, setIsScheduling] = useState(false)
  // ##### END BACKEND #####

  // Get visible calendar IDs for filtering events
  const visibleCalendarIds = calendars.filter(cal => cal.isVisible).map(cal => cal.id)
  const mergedScheduleEvents = useMemo(
    () => mergeScheduleEvents(dashboardData?.events || [], scheduledOverlayEvents),
    [dashboardData?.events, scheduledOverlayEvents],
  )
  
  // Get the active calendar object
  const activeCalendar = activeCalendarId 
    ? calendars.find(cal => cal.id === activeCalendarId) || null 
    : null

  // Toggle dark/light mode
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
  }, [isDarkMode])

  const handleToggleTheme = () => {
    setIsDarkMode(!isDarkMode)
  }

  // API Hook: Replace with actual Google Calendar sync
  const handleSyncWithGoogle = () => {
    console.log("Syncing with Google Calendar...")
  }

  const handleOpenCalendarsSidebar = () => {
    setCalendarsSidebarOpen(true)
  }
  
  // ##### BACKEND API #####
  // DO NOT MODIFY UNLESS BACKEND OWNER
  useEffect(() => {
    let isActive = true

    const loadDashboard = async () => {
      const data = await getDashboardData()

      if (!isActive || !data) {
        return
      }

      console.log("Loaded dashboard data", data)
      setDashboardData(data)
      setTasks(data.tasks)
    }

    const handleDashboardRefresh = () => {
      void loadDashboard()
    }

    void loadDashboard()
    window.addEventListener(DASHBOARD_REFRESH_EVENT, handleDashboardRefresh)

    return () => {
      isActive = false
      window.removeEventListener(DASHBOARD_REFRESH_EVENT, handleDashboardRefresh)
    }
  }, [])

  useEffect(() => {
    setCalendars((currentCalendars) => {
      const knownCalendarIds = new Set(currentCalendars.map((calendar) => calendar.id))
      const nextCalendars = [...currentCalendars]

      for (const task of tasks) {
        if (!task.calendarId) {
          continue
        }

        const displayCalendarId = getDisplayCalendarId(task.calendarId)

        if (knownCalendarIds.has(displayCalendarId)) {
          continue
        }

        nextCalendars.push(createCalendarFromId(displayCalendarId))
        knownCalendarIds.add(displayCalendarId)
      }

      for (const event of mergedScheduleEvents) {
        const displayCalendarId = getDisplayCalendarId(event.calendarId)

        if (knownCalendarIds.has(displayCalendarId)) {
          continue
        }

        nextCalendars.push(createCalendarFromId(displayCalendarId))
        knownCalendarIds.add(displayCalendarId)
      }

      return nextCalendars.length === currentCalendars.length ? currentCalendars : nextCalendars
    })
  }, [mergedScheduleEvents, tasks])

  const clearTaskError = () => {
    setTaskErrorMessage("")
  }

  const handleCreateTask = async (input: CreateTaskRequest) => {
    clearTaskError()

    const optimisticTask = buildOptimisticTask(getCurrentUserId(tasks, dashboardData), input)
    const previousTasks = tasks

    setTasks((current) => [...current, optimisticTask])

    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok || !payload) {
        throw new Error(getApiErrorMessage(payload, "Failed to create task."))
      }

      const taskResponse = payload as TaskMutationResponse

      setTasks((current) =>
        current.map((task) => (task.id === optimisticTask.id ? taskResponse.task : task)),
      )
    } catch (error) {
      setTasks(previousTasks)
      setTaskErrorMessage(error instanceof Error ? error.message : "Failed to create task.")
    }
  }

  const handleUpdateTask = async (taskId: string, input: UpdateTaskRequest) => {
    const existingTask = tasks.find((task) => task.id === taskId)

    if (!existingTask) {
      return
    }

    clearTaskError()

    const previousTasks = tasks
    const previousOverlayEvents = scheduledOverlayEvents
    const optimisticTask = mergeTaskUpdate(existingTask, input)

    setTasks((current) =>
      current.map((task) => (task.id === taskId ? optimisticTask : task)),
    )
    setScheduledOverlayEvents((current) => {
      if (optimisticTask.status === "completed") {
        return current.filter((event) => event.taskId !== taskId)
      }

      return current.map((event) =>
        event.taskId === taskId
          ? {
              ...event,
              title: optimisticTask.title,
            }
          : event,
      )
    })

    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok || !payload) {
        throw new Error(getApiErrorMessage(payload, "Failed to update task."))
      }

      const taskResponse = payload as TaskMutationResponse

      setTasks((current) =>
        current.map((task) => (task.id === taskId ? taskResponse.task : task)),
      )
      setScheduledOverlayEvents((current) => {
        if (taskResponse.task.status === "completed") {
          return current.filter((event) => event.taskId !== taskId)
        }

        return current.map((event) =>
          event.taskId === taskId
            ? {
                ...event,
                title: taskResponse.task.title,
              }
            : event,
        )
      })
    } catch (error) {
      setTasks(previousTasks)
      setScheduledOverlayEvents(previousOverlayEvents)
      setTaskErrorMessage(error instanceof Error ? error.message : "Failed to update task.")
    }
  }

  const handleDeleteTask = async (taskId: string) => {
    clearTaskError()

    const previousTasks = tasks
    const previousOverlayEvents = scheduledOverlayEvents

    setTasks((current) => current.filter((task) => task.id !== taskId))
    setScheduledOverlayEvents((current) => current.filter((event) => event.taskId !== taskId))

    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "DELETE",
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok || !payload) {
        throw new Error(getApiErrorMessage(payload, "Failed to delete task."))
      }

      const deleteResponse = payload as DeleteTaskResponse

      setTasks((current) => current.filter((task) => task.id !== deleteResponse.id))
    } catch (error) {
      setTasks(previousTasks)
      setScheduledOverlayEvents(previousOverlayEvents)
      setTaskErrorMessage(error instanceof Error ? error.message : "Failed to delete task.")
    }
  }

  const handleSchedule = async () => {
    if (isScheduling || !dashboardData) {
      return
    }

    setIsScheduling(true)
    setPlannerStatus("Scheduling...")
    setPlannerSummary("")

    try {
      const visibleHardEvents = dashboardData.events
        .filter((event) => !event.calendarId || visibleCalendarIds.includes(event.calendarId))
        .map(toScheduleEventInput)

      const response = await fetch("/api/schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          taskIds: [],
          hardEvents: visibleHardEvents,
        }),
      })

      const payload = await response.json().catch(() => null)

      if (!response.ok || !payload) {
        throw new Error(getApiErrorMessage(payload, "Scheduling failed."))
      }

      const scheduleResponse = payload as ScheduleResponse

      setScheduledOverlayEvents(scheduleResponse.schedule.proposedEvents)
      setTasks((current) => applyScheduleToTasks(current, scheduleResponse.schedule))
      setPlannerStatus(scheduleResponse.schedule.plannerStatus === "ready" ? "Ready" : "Not scheduled")
      setPlannerSummary(scheduleResponse.schedule.summary)
    } catch (error) {
      setPlannerStatus("Error")
      setPlannerSummary(error instanceof Error ? error.message : "Scheduling failed.")
    } finally {
      setIsScheduling(false)
    }
  }
  // ##### END BACKEND #####

  const renderLeftPanelContent = () => {
    if (activePanelTab === "tasks") {
      return (
        <TaskManager
          mode="all"
          calendars={calendars}
          tasks={tasks}
          errorMessage={taskErrorMessage}
          onClearError={clearTaskError}
          onCreateTask={handleCreateTask}
          onUpdateTask={handleUpdateTask}
          onDeleteTask={handleDeleteTask}
        />
      )
    }

    if (activePanelTab === "inbox") {
      return (
        <PanelPlaceholder
          title="Inbox"
          message="Inbox stays placeholder for this pass while real tasks are wired into the Tasks tab."
        />
      )
    }

    if (activePanelTab === "status") {
      return (
        <PanelPlaceholder
          title="Status"
          message="Status stays placeholder in the left panel for now. The right panel continues to show the live status summary."
        />
      )
    }

    return (
      <>
        <WhatToDoNow currentTask={dashboardData?.currentTask} />
      </>
    )
  }

  return (
    <div className={`h-screen overflow-hidden text-foreground p-3 md:p-4 ${isDarkMode ? "bg-[#0a0a0a]" : "bg-gray-50"}`}>
      <div className="max-w-[1600px] mx-auto h-full flex flex-col">
        {/* Header */}
        <DashboardHeader 
          onTogglePanels={() => setRightColumnOpen((current) => !current)} 
          onToggleMobileMenu={() => setMobileMenuOpen(!mobileMenuOpen)}
          onToggleTheme={handleToggleTheme}
          onOpenCalendars={handleOpenCalendarsSidebar}
          panelsHidden={!rightColumnOpen}
          isDarkMode={isDarkMode}
        />

        {/* Calendars Sidebar - Slide-in from left */}
        <CalendarsSidebar
          isOpen={calendarsSidebarOpen}
          onClose={() => setCalendarsSidebarOpen(false)}
          calendars={calendars}
          onCalendarsChange={setCalendars}
          onSelectCalendar={setActiveCalendarId}
          activeCalendarId={activeCalendarId}
        />
        
        {/* Mobile Navigation Menu */}
        {mobileMenuOpen && (
          <div className={`fixed inset-0 z-50 ${isDarkMode ? "bg-[#0a0a0a]" : "bg-gray-50"} md:hidden`}>
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-base font-bold text-foreground">Navigation</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMobileMenuOpen(false)}
                className="text-muted-foreground hover:text-foreground p-2"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
            <div className="p-4 space-y-2">
              {[
                { id: "command" as const, label: "Command Center" },
                { id: "schedule" as const, label: "Schedule" },
                { id: "status" as const, label: "Status" },
              ].map((section) => (
                <Button
                  key={section.id}
                  variant={mobileSection === section.id ? "default" : "ghost"}
                  className={`w-full justify-start text-sm font-semibold ${
                    mobileSection === section.id
                      ? "bg-[#3b82f6] text-white"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                  onClick={() => {
                    setMobileSection(section.id)
                    setMobileMenuOpen(false)
                  }}
                >
                  {section.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Hide Panels Toggle - Desktop only */}
        <div className="hidden md:flex mb-3 items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRightColumnOpen((current) => !current)}
            className="text-muted-foreground hover:text-foreground hover:bg-secondary text-xs h-7 font-semibold"
          >
            {rightColumnOpen ? "Close Right Column" : "Open Right Column"}
          </Button>
          <span className="text-xs text-muted-foreground font-medium">
            Master input stays pinned on the left. Toggle the right column when you need extra detail.
          </span>
        </div>

        {/* Mobile Section Navigation */}
        <div className="flex md:hidden gap-1 mb-3 bg-secondary/50 rounded-lg p-0.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleOpenCalendarsSidebar}
            className="text-muted-foreground hover:text-foreground h-7 w-9 p-0"
          >
            <Book className="w-4 h-4" />
          </Button>
          {[
            { id: "command" as const, label: "Command" },
            { id: "schedule" as const, label: "Schedule" },
            { id: "status" as const, label: "Status" },
          ].map((section) => (
            <Button
              key={section.id}
              variant={mobileSection === section.id ? "default" : "ghost"}
              size="sm"
              onClick={() => setMobileSection(section.id)}
              className={`flex-1 text-sm font-semibold ${
                mobileSection === section.id
                  ? "bg-[#3b82f6] text-white text-xs h-7 font-semibold"
                  : "text-muted-foreground hover:text-foreground text-xs h-7 font-semibold"
              }`}
            >
              {section.label}
            </Button>
          ))}
        </div>

        {/* Mobile Content */}
        <div className="md:hidden flex-1 overflow-auto">
          {mobileSection === "command" && (
            <div className="flex flex-col gap-3 h-full overflow-auto">
              <MasterInput />
              <WorkspaceSnapshot stats={dashboardData?.stats} />
              <PanelTabs activeTab={activePanelTab} onTabChange={setActivePanelTab} />
              {renderLeftPanelContent()}
            </div>
          )}
          {mobileSection === "schedule" && (
            <div className="h-full">
              <ScheduleView 
                onSyncWithGoogle={handleSyncWithGoogle}
                visibleCalendarIds={visibleCalendarIds}
                calendars={calendars}
                events={mergedScheduleEvents}
                tasks={tasks}
                plannerStatus={plannerStatus}
                plannerSummary={plannerSummary}
                onSchedule={handleSchedule}
                isScheduling={isScheduling}
              />
            </div>
          )}
          {mobileSection === "status" && (
            <div>
              {activeCalendar ? (
                <TaskManager 
                  mode="calendar"
                  calendar={activeCalendar}
                  calendars={calendars}
                  tasks={tasks}
                  errorMessage={taskErrorMessage}
                  onClearError={clearTaskError}
                  onCreateTask={handleCreateTask}
                  onUpdateTask={handleUpdateTask}
                  onDeleteTask={handleDeleteTask}
                />
              ) : (
                <StatusPanel stats={dashboardData?.stats} />
              )}
            </div>
          )}
        </div>

        {/* Desktop Main Content Grid - iCal compact style, fit to screen */}
        <div className="hidden md:block flex-1 overflow-hidden">
          <ResizablePanelGroup
            direction="horizontal"
            autoSaveId={rightColumnOpen ? "dashboard-panels-with-right" : "dashboard-panels-main"}
            className="h-full w-full gap-3"
          >
            <ResizablePanel defaultSize={36} minSize={24} maxSize={55}>
              <div className="h-full overflow-auto pr-1">
                <div className="flex flex-col gap-3">
                  <MasterInput />
                  <WorkspaceSnapshot stats={dashboardData?.stats} />
                  <PanelTabs activeTab={activePanelTab} onTabChange={setActivePanelTab} />
                  {renderLeftPanelContent()}
                </div>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle className="mx-1" />

            <ResizablePanel defaultSize={rightColumnOpen ? 44 : 64} minSize={30}>
              <div className="h-full overflow-hidden">
                <ScheduleView 
                  onSyncWithGoogle={handleSyncWithGoogle}
                  visibleCalendarIds={visibleCalendarIds}
                  calendars={calendars}
                  events={mergedScheduleEvents}
                  tasks={tasks}
                  plannerStatus={plannerStatus}
                  plannerSummary={plannerSummary}
                  onSchedule={handleSchedule}
                  isScheduling={isScheduling}
                />
              </div>
            </ResizablePanel>

            {rightColumnOpen && (
              <>
                <ResizableHandle withHandle className="mx-1" />
                <ResizablePanel defaultSize={20} minSize={16} maxSize={30}>
                  <div className="h-full overflow-auto pl-1">
                    {activeCalendar ? (
                      <TaskManager 
                        mode="calendar"
                        calendar={activeCalendar}
                        calendars={calendars}
                        tasks={tasks}
                        errorMessage={taskErrorMessage}
                        onClearError={clearTaskError}
                        onCreateTask={handleCreateTask}
                        onUpdateTask={handleUpdateTask}
                        onDeleteTask={handleDeleteTask}
                      />
                    ) : (
                      <StatusPanel stats={dashboardData?.stats} />
                    )}
                  </div>
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>
      </div>
    </div>
  )
}
