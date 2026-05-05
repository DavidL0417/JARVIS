"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import dynamic from "next/dynamic"
import {
  AlertTriangle,
  Brain,
  CalendarDays,
  Database,
  HelpCircle,
  Inbox,
  Loader2,
  Moon,
  PanelLeft,
  RefreshCw,
  Sparkles,
  ListTodo,
  type LucideIcon,
} from "lucide-react"

import { AuthControls } from "@/components/auth/auth-controls"
import {
  CalendarsSidebar,
  sortCalendars,
  toSidebarCalendar,
  type Calendar,
} from "@/components/dashboard/calendars-sidebar"
import { CheckInSidebar } from "@/components/dashboard/checkin-sidebar"
import { LandingPage } from "@/components/dashboard/landing-page"
import { MasterInput } from "@/components/dashboard/master-input"
import { OnboardingPanel } from "@/components/dashboard/onboarding-panel"
import { TaskManager } from "@/components/dashboard/task-manager"
import { Button } from "@/components/ui/button"
import type {
  CalendarListResponse,
  CheckInApprovalItem,
  CheckInApprovalListResponse,
  CreateTaskRequest,
  DashboardResponse,
  DeleteTaskResponse,
  ScheduleEvent,
  ScheduleEventInput,
  ScheduleResponse,
  TaskMutationResponse,
  UpdateTaskRequest,
} from "@/types"

const ScheduleView = dynamic(
  () => import("@/components/dashboard/schedule-view").then((module) => module.ScheduleView),
  { ssr: false },
)

const DASHBOARD_REFRESH_EVENT = "jarvis-dashboard-refresh"
const DEFAULT_TASK_CALENDAR_ID = "cal-tasks"

type DashboardViewState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "error"; message: string }
  | { status: "ready"; dashboard: DashboardResponse }

type PlannerUiStatus = "Idle" | "Scheduling" | "Ready" | "Error"

class AuthRequiredError extends Error {}

function getApiErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const details = "details" in payload && typeof payload.details === "string" ? payload.details : null
    const error = "error" in payload && typeof payload.error === "string" ? payload.error : null
    return details || error || fallback
  }

  return fallback
}

async function fetchJson<T>(url: string, fallback: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
  })
  const payload = await response.json().catch(() => null)

  if (response.status === 401) {
    throw new AuthRequiredError("Authentication required.")
  }

  if (!response.ok || !payload) {
    throw new Error(getApiErrorMessage(payload, fallback))
  }

  return payload as T
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

function StatusChip({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: string | number
}) {
  return (
    <div className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-border bg-surface-subtle px-2.5">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
      <span className="ml-auto text-sm font-semibold text-foreground">{value}</span>
    </div>
  )
}

function ShellMessage({
  icon: Icon,
  title,
  detail,
  action,
}: {
  icon: LucideIcon
  title: string
  detail: string
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background">
            <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-2">
            <h1 className="text-base font-semibold text-foreground">{title}</h1>
            <p className="text-sm leading-6 text-muted-foreground">{detail}</p>
            {action ? <div className="pt-2">{action}</div> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [viewState, setViewState] = useState<DashboardViewState>({ status: "loading" })
  const [calendars, setCalendars] = useState<Calendar[]>([])
  const [calendarsSidebarOpen, setCalendarsSidebarOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [pendingCheckInItems, setPendingCheckInItems] = useState<CheckInApprovalItem[]>([])
  const [plannerStatus, setPlannerStatus] = useState<PlannerUiStatus>("Idle")
  const [plannerSummary, setPlannerSummary] = useState("")
  const [isScheduling, setIsScheduling] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [taskErrorMessage, setTaskErrorMessage] = useState("")

  const dashboard = viewState.status === "ready" ? viewState.dashboard : null
  const pendingCheckInEvents = useMemo(
    () => pendingCheckInItems.map((item) => item.event),
    [pendingCheckInItems],
  )
  const visibleCalendarIds = useMemo<string[] | undefined>(() => {
    if (calendars.length === 0) {
      return undefined
    }

    const nextIds = calendars.filter((calendar) => calendar.isVisible).map((calendar) => calendar.id)

    if (!nextIds.includes(DEFAULT_TASK_CALENDAR_ID)) {
      nextIds.push(DEFAULT_TASK_CALENDAR_ID)
    }

    return nextIds
  }, [calendars])

  const loadDashboard = useCallback(async (quiet = false) => {
    if (quiet) {
      setIsRefreshing(true)
    } else {
      setViewState({ status: "loading" })
    }

    try {
      const [dashboardData, calendarData, checkInData] = await Promise.all([
        fetchJson<DashboardResponse>("/api/dashboard", "Failed to load dashboard."),
        fetchJson<CalendarListResponse>("/api/calendars", "Failed to load calendars."),
        fetchJson<CheckInApprovalListResponse>("/api/checkin", "Failed to load check-ins."),
      ])

      setViewState({ status: "ready", dashboard: dashboardData })
      setCalendars(sortCalendars(calendarData.calendars.map(toSidebarCalendar)))
      setPendingCheckInItems(checkInData.items)
      setTaskErrorMessage("")
      return dashboardData
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setViewState({ status: "signed-out" })
        setCalendars([])
        setPendingCheckInItems([])
      } else {
        setViewState({
          status: "error",
          message: error instanceof Error ? error.message : "Backend request failed.",
        })
      }
      return null
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadDashboard()

    const handleRefresh = () => {
      void loadDashboard(true)
    }

    window.addEventListener(DASHBOARD_REFRESH_EVENT, handleRefresh)
    return () => window.removeEventListener(DASHBOARD_REFRESH_EVENT, handleRefresh)
  }, [loadDashboard])

  async function handleCreateTask(input: CreateTaskRequest) {
    setTaskErrorMessage("")

    try {
      await fetchJson<TaskMutationResponse>("/api/tasks", "Failed to create task.", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      await loadDashboard(true)
    } catch (error) {
      setTaskErrorMessage(error instanceof Error ? error.message : "Failed to create task.")
    }
  }

  async function handleUpdateTask(taskId: string, input: UpdateTaskRequest) {
    setTaskErrorMessage("")

    try {
      await fetchJson<TaskMutationResponse>(`/api/tasks/${taskId}`, "Failed to update task.", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      await loadDashboard(true)
    } catch (error) {
      setTaskErrorMessage(error instanceof Error ? error.message : "Failed to update task.")
    }
  }

  async function handleDeleteTask(taskId: string) {
    setTaskErrorMessage("")

    try {
      await fetchJson<DeleteTaskResponse>(`/api/tasks/${taskId}`, "Failed to delete task.", {
        method: "DELETE",
      })
      await loadDashboard(true)
    } catch (error) {
      setTaskErrorMessage(error instanceof Error ? error.message : "Failed to delete task.")
    }
  }

  async function handleToggleTaskComplete(task: DashboardResponse["tasks"][number]) {
    await handleUpdateTask(task.id, {
      status: task.status === "completed" ? "todo" : "completed",
    })
  }

  async function handleSchedule(taskIds: string[] = [], dashboardOverride?: DashboardResponse | null) {
    const currentDashboard = dashboardOverride ?? dashboard

    if (isScheduling || !currentDashboard) {
      return
    }

    setIsScheduling(true)
    setPlannerStatus("Scheduling")
    setPlannerSummary("")

    try {
      const selectedTaskIds = new Set(taskIds)
      const hardEvents = currentDashboard.events
        .filter((event) => !event.taskId || !selectedTaskIds.has(event.taskId))
        .filter((event) => !visibleCalendarIds || !event.calendarId || visibleCalendarIds.includes(event.calendarId))
        .map(toScheduleEventInput)

      const scheduleResponse = await fetchJson<ScheduleResponse>("/api/schedule", "Scheduling failed.", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskIds,
          hardEvents,
        }),
      })

      setPlannerStatus(scheduleResponse.schedule.plannerStatus === "ready" ? "Ready" : "Idle")
      setPlannerSummary(scheduleResponse.schedule.summary)
      await loadDashboard(true)
    } catch (error) {
      setPlannerStatus("Error")
      setPlannerSummary(error instanceof Error ? error.message : "Scheduling failed.")
    } finally {
      setIsScheduling(false)
    }
  }

  const handleEventApproved = useCallback(
    async () => {
      await loadDashboard(true)
    },
    [loadDashboard],
  )

  const handleOnboardingComplete = useCallback(
    async ({ scheduleAfter }: { scheduleAfter: boolean }) => {
      const nextDashboard = await loadDashboard(true)

      if (scheduleAfter && nextDashboard) {
        await handleSchedule([], nextDashboard)
      }
    },
    [handleSchedule, loadDashboard],
  )

  const renderContent = () => {
    if (viewState.status === "loading") {
      return (
        <ShellMessage
          icon={Loader2}
          title="Loading"
          detail="Connecting to Supabase and reading your scheduler state."
        />
      )
    }

    if (viewState.status === "signed-out") {
      return null
    }

    if (viewState.status === "error") {
      return (
        <ShellMessage
          icon={AlertTriangle}
          title="Backend unavailable"
          detail={viewState.message}
          action={
            <Button size="sm" variant="outline" onClick={() => loadDashboard()} className="gap-2">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Retry
            </Button>
          }
        />
      )
    }

    const dashboardData = viewState.dashboard
    const isEmpty = dashboardData.tasks.length === 0 && dashboardData.events.length === 0

    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex min-h-9 flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-2 py-2">
          <StatusChip icon={ListTodo} label="Tasks" value={dashboardData.stats.tasks} />
          <StatusChip icon={Inbox} label="Unscheduled" value={dashboardData.stats.unscheduled} />
          <StatusChip icon={Brain} label="Memory" value={dashboardData.stats.memories} />
          <StatusChip icon={Database} label="Sources" value={dashboardData.stats.sources} />
          <div className="ml-auto hidden items-center gap-2 px-2 text-xs text-muted-foreground lg:flex">
            <Moon className="size-3.5 text-primary" aria-hidden="true" />
            Plan from real state. Empty means empty.
          </div>
        </div>

        {isEmpty ? (
          <div className="rounded-md border border-primary/25 bg-primary/10 px-3 py-2 text-xs text-foreground">
            Start with setup in the right rail, or add a task manually. JARVIS will not invent placeholder work.
          </div>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-h-[620px] xl:min-h-0">
            <ScheduleView
              calendars={calendars}
              visibleCalendarIds={visibleCalendarIds}
              events={dashboardData.events}
              tasks={dashboardData.tasks}
              onToggleTaskComplete={handleToggleTaskComplete}
              plannerStatus={plannerStatus}
              plannerSummary={plannerSummary}
              onSchedule={() => handleSchedule()}
              isScheduling={isScheduling}
            />
          </div>

          <div className="flex min-h-0 flex-col gap-3 xl:overflow-auto xl:pr-1">
            <OnboardingPanel
              isEmpty={isEmpty}
              forceOpen={guideOpen}
              onForceOpenChange={setGuideOpen}
              onComplete={handleOnboardingComplete}
            />
            <MasterInput tasks={dashboardData.tasks} />
            {pendingCheckInEvents.length > 0 ? (
              <CheckInSidebar
                events={pendingCheckInEvents}
                calendars={calendars}
                onEventApproved={handleEventApproved}
              />
            ) : null}
            <TaskManager
              mode="all"
              calendars={calendars}
              tasks={dashboardData.tasks}
              scheduleEvents={dashboardData.events}
              errorMessage={taskErrorMessage}
              onClearError={() => setTaskErrorMessage("")}
              onCreateTask={handleCreateTask}
              onUpdateTask={handleUpdateTask}
              onDeleteTask={handleDeleteTask}
            />
          </div>
        </div>
      </div>
    )
  }

  if (viewState.status === "signed-out") {
    return <LandingPage authControls={<AuthControls />} />
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-background text-foreground xl:h-screen xl:overflow-hidden">
      <div className="mx-auto flex min-h-screen max-w-[1720px] gap-3 p-3 xl:h-full xl:min-h-0">
        <aside className="hidden w-12 shrink-0 flex-col items-center gap-2 rounded-lg border border-border bg-sidebar p-2 md:flex">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Calendars"
            title="Calendars"
            onClick={() => setCalendarsSidebarOpen(true)}
          >
            <PanelLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Refresh"
            title="Refresh"
            onClick={() => loadDashboard(true)}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Schedule"
            title="Schedule"
            onClick={() => handleSchedule()}
            disabled={isScheduling || !dashboard}
          >
            {isScheduling ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
            )}
          </Button>
          <div className="my-1 h-px w-6 bg-border" />
          <Button
            size="icon"
            variant="ghost"
            aria-label="Guide"
            title="Guide"
            onClick={() => setGuideOpen(true)}
          >
            <HelpCircle className="h-4 w-4" aria-hidden="true" />
          </Button>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col gap-3">
          <header className="flex h-auto shrink-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-subtle">
                <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold text-foreground">JARVIS</h1>
                <p className="truncate text-[11px] text-muted-foreground">Late-night planning workbench</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="ghost"
                aria-label="Guide"
                title="Guide"
                onClick={() => setGuideOpen(true)}
                className="md:hidden"
              >
                <HelpCircle className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Calendars"
                title="Calendars"
                onClick={() => setCalendarsSidebarOpen(true)}
                className="md:hidden"
              >
                <PanelLeft className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Schedule"
                title="Schedule"
                onClick={() => handleSchedule()}
                disabled={isScheduling || !dashboard}
                className="md:hidden"
              >
                {isScheduling ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>
              <AuthControls />
            </div>
          </header>

          {renderContent()}
        </section>
      </div>

      <CalendarsSidebar
        isOpen={calendarsSidebarOpen}
        onClose={() => setCalendarsSidebarOpen(false)}
        calendars={calendars}
        onCalendarsChange={setCalendars}
      />
    </main>
  )
}
