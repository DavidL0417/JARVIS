"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { AuthControls } from "@/components/auth/auth-controls"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { WorkspaceSnapshot } from "@/components/dashboard/workspace-snapshot"
import { PanelTabs, type PanelTabId } from "@/components/dashboard/panel-tabs"
import { MasterInput } from "@/components/dashboard/master-input"
import { WhatToDoNow } from "@/components/dashboard/what-to-do-now"
import { StatusPanel } from "@/components/dashboard/status-panel"
import {
  CalendarsSidebar,
  sortCalendars,
  toSidebarCalendar,
  type Calendar,
} from "@/components/dashboard/calendars-sidebar"
import { CheckInSidebar } from "@/components/dashboard/checkin-sidebar"
import { TaskManager } from "@/components/dashboard/task-manager"
import { TaskSidebar } from "@/components/dashboard/task-sidebar"
import { TASKS_CALENDAR_ID } from "@/lib/task-calendar-constants"
import { X, Book } from "lucide-react"
// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER
import { getCalendarsData } from "@/lib/data/calendars"
import { getPendingCheckInApprovals } from "@/lib/data/checkins"
import { getDashboardData } from "@/lib/data/dashboard"
import type {
  CheckInApprovalItem,
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
type FocusQueueTone = "neutral" | "warning" | "critical"

const ScheduleView = dynamic(
  () => import("@/components/dashboard/schedule-view").then((module) => module.ScheduleView),
  { ssr: false },
)

const DEFAULT_BACKEND_CALENDAR_ID = "calendar-main"
const DEFAULT_TASK_CALENDAR_ID = "cal-tasks"
const FALLBACK_USER_ID = "00000000-0000-4000-8000-000000000000"
const DASHBOARD_REFRESH_EVENT = "jarvis-dashboard-refresh"

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
    priority: event.priority,
    taskId: event.taskId,
    status: event.status,
    location: event.location,
    externalEventId: event.externalEventId,
    gcalEventId: event.gcalEventId,
    lastSyncedFrom: event.lastSyncedFrom,
    isImmutable: event.isImmutable,
    isCheckedIn: event.isCheckedIn,
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
    calendarId: input.calendarId ?? DEFAULT_TASK_CALENDAR_ID,
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

function FocusQueueCard({
  title,
  count,
  message,
  tone = "neutral",
}: {
  title: string
  count: number
  message: string
  tone?: FocusQueueTone
}) {
  const toneClasses =
    tone === "critical"
      ? "border-red-500/25 bg-red-500/10"
      : tone === "warning"
        ? "border-amber-500/25 bg-amber-500/10"
        : "border-sky-500/25 bg-sky-500/10"

  return (
    <Card className={`border shadow-[0_16px_40px_rgba(0,0,0,0.18)] ${toneClasses}`}>
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm font-bold text-foreground">{title}</CardTitle>
          <div className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {count}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <p className="text-xs font-medium text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  )
}

export default function DashboardPage() {
  const [rightColumnOpen, setRightColumnOpen] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mobileSection, setMobileSection] = useState<MobileSection>("schedule")
  const [activePanelTab, setActivePanelTab] = useState<PanelTabId>("focus")
  
  // Calendar management state
  const [calendarsSidebarOpen, setCalendarsSidebarOpen] = useState(false)
  const [calendars, setCalendars] = useState<Calendar[]>([])
  const [activeCalendarId, setActiveCalendarId] = useState<string | null>(null)
  const [pendingCheckInItems, setPendingCheckInItems] = useState<CheckInApprovalItem[]>([])
  
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
  const visibleCalendarIds = useMemo<string[] | undefined>(() => {
    if (calendars.length === 0) {
      return undefined
    }

    const nextIds = calendars.filter((calendar) => calendar.isVisible).map((calendar) => calendar.id)

    if (!nextIds.includes(DEFAULT_BACKEND_CALENDAR_ID)) {
      nextIds.push(DEFAULT_BACKEND_CALENDAR_ID)
    }

    return nextIds
  }, [calendars])
  const mergedScheduleEvents = useMemo(
    () => mergeScheduleEvents(dashboardData?.events || [], scheduledOverlayEvents),
    [dashboardData?.events, scheduledOverlayEvents],
  )
  const pendingCheckInEvents = useMemo(
    () => pendingCheckInItems.map((item) => item.event),
    [pendingCheckInItems],
  )
  const calendarRegistryNeedsSchema = useMemo(
    () => calendars.some((calendar) => calendar.source === "task" && !calendar.recordId),
    [calendars],
  )
  
  // Get the active calendar object
  const activeCalendar = activeCalendarId 
    ? calendars.find(cal => cal.id === activeCalendarId) || null 
    : null
  const isTaskCalendarActive = activeCalendar?.id === TASKS_CALENDAR_ID

  const handleOpenCalendarsSidebar = () => {
    setCalendarsSidebarOpen(true)
  }
  
  // ##### BACKEND API #####
  // DO NOT MODIFY UNLESS BACKEND OWNER
  const loadDashboard = useCallback(async () => {
    const [data, calendarData, checkInData] = await Promise.all([
      getDashboardData(),
      getCalendarsData(),
      getPendingCheckInApprovals(),
    ])

    if (!data) {
      setDashboardData(null)
      setCalendars([])
      setPendingCheckInItems([])
      setTasks([])
      setScheduledOverlayEvents([])
      setPlannerStatus("Not scheduled")
      setPlannerSummary("")
      return
    }

    console.log("Loaded dashboard data", data)
    setDashboardData(data)
    setTasks(data.tasks)
    setScheduledOverlayEvents([])
    setPendingCheckInItems(checkInData ?? [])

    if (calendarData) {
      setCalendars(sortCalendars(calendarData.map(toSidebarCalendar)))
    }
  }, [])

  useEffect(() => {
    let isActive = true

    const loadDashboardSafely = async () => {
      const [data, calendarData, checkInData] = await Promise.all([
        getDashboardData(),
        getCalendarsData(),
        getPendingCheckInApprovals(),
      ])

      if (!isActive) {
        return
      }

      if (!data) {
        setDashboardData(null)
        setCalendars([])
        setPendingCheckInItems([])
        setTasks([])
        setScheduledOverlayEvents([])
        setPlannerStatus("Not scheduled")
        setPlannerSummary("")
        return
      }

      console.log("Loaded dashboard data", data)
      setDashboardData(data)
      setTasks(data.tasks)
      setScheduledOverlayEvents([])
      setPendingCheckInItems(checkInData ?? [])

      if (calendarData) {
        setCalendars(sortCalendars(calendarData.map(toSidebarCalendar)))
      }
    }

    const handleDashboardRefresh = () => {
      void loadDashboard()
    }

    void loadDashboardSafely()
    window.addEventListener(DASHBOARD_REFRESH_EVENT, handleDashboardRefresh)

    return () => {
      isActive = false
      window.removeEventListener(DASHBOARD_REFRESH_EVENT, handleDashboardRefresh)
    }
  }, [loadDashboard])

  useEffect(() => {
    if (activeCalendarId && !calendars.some((calendar) => calendar.id === activeCalendarId)) {
      setActiveCalendarId(null)
    }
  }, [activeCalendarId, calendars])

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

  const handleSchedule = async (taskIds: string[] = []) => {
    if (isScheduling || !dashboardData) {
      return
    }

    setIsScheduling(true)
    setPlannerStatus("Scheduling...")
    setPlannerSummary("")

    try {
      const selectedTaskIds = new Set(taskIds)
      const visibleHardEvents = dashboardData.events
        .filter(
          (event) =>
            !visibleCalendarIds ||
            !event.calendarId ||
            visibleCalendarIds.includes(event.calendarId),
        )
        .filter((event) => !event.taskId || !selectedTaskIds.has(event.taskId))
        .map(toScheduleEventInput)

      const response = await fetch("/api/schedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          taskIds,
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
      void loadDashboard()
    } catch (error) {
      setPlannerStatus("Error")
      setPlannerSummary(error instanceof Error ? error.message : "Scheduling failed.")
    } finally {
      setIsScheduling(false)
    }
  }

  const handleScheduleTask = async (taskId: string) => {
    await handleSchedule([taskId])
  }
  // ##### END BACKEND #####

  const handleEventApproved = useCallback((approvedEvent: ScheduleEvent) => {
    setPendingCheckInItems((currentItems) =>
      currentItems.filter((item) => item.event.id !== approvedEvent.id),
    )

    setDashboardData((currentData) => {
      if (!currentData) {
        return currentData
      }

      return {
        ...currentData,
        events: currentData.events.map((event) =>
          event.id === approvedEvent.id ? approvedEvent : event,
        ),
      }
    })

    setScheduledOverlayEvents((currentEvents) =>
      currentEvents.map((event) => (event.id === approvedEvent.id ? approvedEvent : event)),
    )

    if (approvedEvent.taskId) {
      setTasks((currentTasks) =>
        currentTasks.map((task) =>
          task.id === approvedEvent.taskId
            ? {
                ...task,
                priority: approvedEvent.priority,
                isImmutable: approvedEvent.isImmutable,
              }
            : task,
        ),
      )
    }
  }, [])

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
        <FocusQueueCard
          title="Decision Queue"
          count={dashboardData?.stats.unscheduled ?? 0}
          tone={(dashboardData?.stats.unscheduled ?? 0) > 0 ? "warning" : "neutral"}
          message={
            (dashboardData?.stats.unscheduled ?? 0) > 0
              ? `${dashboardData?.stats.unscheduled ?? 0} tasks still need a slot. Use Schedule or tell Master Input what changed.`
              : "No loose tasks in the queue right now. New requests can go straight through Master Input."
          }
        />
      )
    }

    if (activePanelTab === "status") {
      return <StatusPanel stats={dashboardData?.stats} />
    }

    return (
      <>
        <WhatToDoNow currentTask={dashboardData?.currentTask} />
      </>
    )
  }

  const renderContextSidebar = () => {
    if (activeCalendar) {
      if (isTaskCalendarActive) {
        return (
          <TaskSidebar
            tasks={tasks}
            scheduleEvents={mergedScheduleEvents}
            errorMessage={taskErrorMessage}
            onClearError={clearTaskError}
            onCreateTask={handleCreateTask}
            onUpdateTask={handleUpdateTask}
            onDeleteTask={handleDeleteTask}
            onScheduleTask={handleScheduleTask}
          />
        )
      }

      return (
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
      )
    }

    return <StatusPanel stats={dashboardData?.stats} />
  }

  const renderRightPanelContent = () => {
    return (
      <div className="space-y-3">
        <CheckInSidebar
          events={pendingCheckInEvents}
          calendars={calendars}
          onEventApproved={handleEventApproved}
        />
        {renderContextSidebar()}
      </div>
    )
  }

  return (
    <div className="h-screen overflow-hidden p-3 text-foreground md:p-4">
      <div className="max-w-[1600px] mx-auto h-full flex flex-col">
        {/* Header */}
        <DashboardHeader 
          onTogglePanels={() => setRightColumnOpen((current) => !current)} 
          onToggleMobileMenu={() => setMobileMenuOpen(!mobileMenuOpen)}
          onOpenCalendars={handleOpenCalendarsSidebar}
          panelsHidden={!rightColumnOpen}
          authControls={<AuthControls />}
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

        {calendarRegistryNeedsSchema ? (
          <div className="mb-3 rounded-[20px] border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs font-medium text-amber-100">
            Calendar registry fallback is active. The live Supabase project is missing `public.user_calendars`, so tasks and assistant flows still work, but full calendar management needs `sql/schema.sql` applied.
          </div>
        ) : null}
        
        {/* Mobile Navigation Menu */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-xl md:hidden">
            <div className="flex items-center justify-between border-b border-border p-4">
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
                      ? "bg-rose-300 text-rose-950 shadow-sm hover:bg-rose-300"
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
        <div className="mb-3 hidden items-center gap-3 rounded-[20px] border border-white/8 bg-white/[0.03] px-3 py-2 md:flex">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRightColumnOpen((current) => !current)}
            className="text-muted-foreground hover:text-foreground hover:bg-secondary text-xs h-7 font-semibold"
          >
            {rightColumnOpen ? "Hide Right Column" : "Open Right Column"}
          </Button>
          <span className="text-xs text-muted-foreground font-medium">
            Master input stays pinned on the left. Keep the right column open for task and status detail.
          </span>
        </div>

        {/* Mobile Section Navigation */}
        <div className="mb-3 flex gap-1 rounded-2xl border border-white/8 bg-white/[0.04] p-1 md:hidden">
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
                  ? "bg-rose-300 text-rose-950 text-xs h-7 font-semibold shadow-sm hover:bg-rose-300"
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
            <div className="space-y-3">{renderRightPanelContent()}</div>
          )}
        </div>

        {/* Desktop Main Content Grid - iCal compact style, fit to screen */}
        <div className="hidden md:block flex-1 overflow-hidden">
          <ResizablePanelGroup
            direction="horizontal"
            autoSaveId={rightColumnOpen ? "dashboard-panels-with-right" : "dashboard-panels-main"}
            className="h-full w-full gap-3"
          >
            <ResizablePanel defaultSize={30} minSize={22} maxSize={42}>
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

            <ResizablePanel defaultSize={rightColumnOpen ? 50 : 70} minSize={34}>
              <div className="h-full overflow-hidden">
                <ScheduleView 
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
                <ResizablePanel defaultSize={20} minSize={18} maxSize={28}>
                  <div className="h-full overflow-auto pl-1">
                    {renderRightPanelContent()}
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
