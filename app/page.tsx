"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import dynamic from "next/dynamic"
import {
  AlertTriangle,
  Brain,
  CalendarDays,
  Database,
  Loader2,
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
import { MasterInput } from "@/components/dashboard/master-input"
import { TaskManager } from "@/components/dashboard/task-manager"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
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

function StatGlyph({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: string | number
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-2 rounded-sm px-1.5 py-1 text-foreground transition-colors hover:bg-accent/60">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" strokeWidth={1.75} />
          <span className="num text-[14px] font-medium tabular-nums leading-none">{value}</span>
          <span className="hidden text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground lg:inline">
            {label}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent sideOffset={6} className="text-[11px]">{label}</TooltipContent>
    </Tooltip>
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
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-sm border border-rule">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold leading-[1.15] tracking-tight text-foreground">{title}</h1>
        <p className="mt-3 max-w-[52ch] text-[13px] leading-6 text-muted-foreground">{detail}</p>
        {action ? <div className="mt-6">{action}</div> : null}
      </div>
    </div>
  )
}

function LiveClock() {
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => {
    setNow(new Date())
    const id = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  if (!now) {
    return <span className="num text-[13px] tabular-nums text-muted-foreground">—:—</span>
  }

  return (
    <span className="num text-[13px] font-medium tabular-nums leading-none text-foreground">
      {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
    </span>
  )
}

function RailButton({
  label,
  icon: Icon,
  onClick,
  disabled,
  active,
  spinning,
}: {
  label: string
  icon: LucideIcon
  onClick: () => void
  disabled?: boolean
  active?: boolean
  spinning?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          className={`group flex h-10 w-10 items-center justify-center rounded-sm transition-colors disabled:opacity-40 ${
            active
              ? "bg-copper-soft text-copper"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          {spinning ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" strokeWidth={1.75} />
          ) : (
            <Icon className="h-[18px] w-[18px]" aria-hidden="true" strokeWidth={1.75} />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={6} className="text-[11px]">{label}</TooltipContent>
    </Tooltip>
  )
}

export default function DashboardPage() {
  const [viewState, setViewState] = useState<DashboardViewState>({ status: "loading" })
  const [calendars, setCalendars] = useState<Calendar[]>([])
  const [calendarsSidebarOpen, setCalendarsSidebarOpen] = useState(false)
  const [pendingCheckInItems, setPendingCheckInItems] = useState<CheckInApprovalItem[]>([])
  const [plannerStatus, setPlannerStatus] = useState<PlannerUiStatus>("Idle")
  const [plannerSummary, setPlannerSummary] = useState("")
  const [isScheduling, setIsScheduling] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [taskErrorMessage, setTaskErrorMessage] = useState("")

  const dashboard = viewState.status === "ready" ? viewState.dashboard : null
  const events = dashboard?.events ?? []
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

  async function handleSchedule(taskIds: string[] = []) {
    if (isScheduling || !dashboard) {
      return
    }

    setIsScheduling(true)
    setPlannerStatus("Scheduling")
    setPlannerSummary("")

    try {
      const selectedTaskIds = new Set(taskIds)
      const hardEvents = events
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

  const renderContent = () => {
    if (viewState.status === "loading") {
      return (
        <ShellMessage
          icon={Loader2}
          title="Loading"
          detail="Reading scheduler state from Supabase."
        />
      )
    }

    if (viewState.status === "signed-out") {
      return (
        <ShellMessage
          icon={Sparkles}
          title="Sign in"
          detail="JARVIS needs an authenticated user before reading tasks, calendars, or memory."
          action={<AuthControls />}
        />
      )
    }

    if (viewState.status === "error") {
      return (
        <ShellMessage
          icon={AlertTriangle}
          title="Backend unavailable"
          detail={viewState.message}
          action={
            <Button size="sm" variant="outline" onClick={() => loadDashboard()} className="gap-2">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Retry
            </Button>
          }
        />
      )
    }

    const dashboardData = viewState.dashboard

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 xl:grid-cols-[minmax(0,1fr)_380px] xl:divide-x xl:divide-rule">
          <div className="min-h-[560px] xl:min-h-0 xl:pr-6">
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

          <div className="flex min-h-0 flex-col gap-6 pt-6 xl:pl-6 xl:pt-0">
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

  const stats = dashboard?.stats

  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={400}>
      <main className="h-screen overflow-hidden bg-background text-foreground">
        <div className="flex h-full">
          <aside className="hidden w-14 shrink-0 flex-col items-center gap-1.5 border-r border-rule py-4 md:flex">
            <RailButton
              label="Calendars"
              icon={PanelLeft}
              onClick={() => setCalendarsSidebarOpen(true)}
              active={calendarsSidebarOpen}
            />
            <RailButton
              label="Refresh"
              icon={RefreshCw}
              onClick={() => loadDashboard(true)}
              disabled={isRefreshing}
              spinning={isRefreshing}
            />
            <RailButton
              label="Schedule"
              icon={CalendarDays}
              onClick={() => handleSchedule()}
              disabled={isScheduling || !dashboard}
              spinning={isScheduling}
            />
          </aside>

          <section className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-16 shrink-0 items-center gap-5 border-b border-rule-strong px-6">
              <div className="flex min-w-0 items-center gap-3">
                <span className="text-[19px] font-semibold leading-none tracking-tight text-foreground">
                  JARVIS
                </span>
                <span className="hidden h-4 w-px bg-rule-strong sm:block" />
                <span className="hidden text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground sm:block">
                  Secretary
                </span>
              </div>

              <div className="ml-auto flex items-center gap-3">
                {stats ? (
                  <div className="hidden items-center gap-1 md:flex">
                    <StatGlyph icon={ListTodo} label="Tasks" value={stats.tasks} />
                    <StatGlyph icon={CalendarDays} label="Loose" value={stats.unscheduled} />
                    <StatGlyph icon={Brain} label="Memory" value={stats.memories} />
                    <StatGlyph icon={Database} label="Sources" value={stats.sources} />
                  </div>
                ) : null}
                <span className="hidden h-5 w-px bg-rule md:block" />
                <LiveClock />
                <button
                  type="button"
                  aria-label="Calendars"
                  onClick={() => setCalendarsSidebarOpen(true)}
                  className="flex h-9 w-9 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
                >
                  <PanelLeft className="h-[18px] w-[18px]" aria-hidden="true" />
                </button>
                <AuthControls />
              </div>
            </header>

            <div className="flex min-h-0 flex-1 flex-col px-6 py-6">{renderContent()}</div>
          </section>
        </div>

        <CalendarsSidebar
          isOpen={calendarsSidebarOpen}
          onClose={() => setCalendarsSidebarOpen(false)}
          calendars={calendars}
          onCalendarsChange={setCalendars}
        />
      </main>
    </TooltipProvider>
  )
}
