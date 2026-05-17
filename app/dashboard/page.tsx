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
  MessageSquare,
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
import { AutoImportDigest } from "@/components/dashboard/auto-import-digest"
import { ContextRailPanel } from "@/components/dashboard/context-rail-panel"
import { DailyCommandStrip } from "@/components/dashboard/daily-command-strip"
import { RailSheet } from "@/components/dashboard/rail-sheet"
import { MemoryPanel } from "@/components/dashboard/memory-panel"
import { SecretaryOverlay } from "@/components/dashboard/secretary-overlay"
import { SourceSetupPanel } from "@/components/dashboard/source-setup-panel"
import { TaskManager } from "@/components/dashboard/task-manager"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DEFAULT_CLAUDE_PLANNER_MODEL_KEY,
  isClaudePlannerModelKey,
  type ClaudePlannerModelKey,
} from "@/lib/ai/claude-models"
import { cn } from "@/lib/utils"
import type {
  CalendarListResponse,
  CreateTaskRequest,
  DashboardResponse,
  DeleteTaskResponse,
  ScheduleEvent,
  ScheduleEventInput,
  TaskMutationResponse,
  UpdateTaskRequest,
} from "@/types"
import type { DailyPlanResponse } from "@/schemas/daily-plan"

const ScheduleView = dynamic(
  () => import("@/components/dashboard/schedule-view").then((module) => module.ScheduleView),
  { ssr: false },
)

const DASHBOARD_REFRESH_EVENT = "jarvis-dashboard-refresh"
const DEFAULT_TASK_CALENDAR_ID = "cal-tasks"
const PLANNER_MODEL_STORAGE_KEY = "jarvis-planner-model"

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
    planId: event.planId,
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
          <span className="num text-[13px] font-medium tabular-nums leading-none">{value}</span>
          <span className="hidden text-[10.5px] uppercase text-muted-foreground lg:inline">
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
        <h1 className="text-2xl font-semibold leading-[1.15] text-foreground">{title}</h1>
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
  badge,
  badgeTone = "copper",
}: {
  label: string
  icon: LucideIcon
  onClick: () => void
  disabled?: boolean
  active?: boolean
  spinning?: boolean
  badge?: boolean
  badgeTone?: "copper" | "destructive"
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          className={cn(
            "group relative flex h-10 w-10 items-center justify-center rounded-sm transition-colors disabled:opacity-40",
            active ? "bg-copper-soft text-copper" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {spinning ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" strokeWidth={1.75} />
          ) : (
            <Icon className="h-[18px] w-[18px]" aria-hidden="true" strokeWidth={1.75} />
          )}
          {badge ? (
            <span
              className={cn(
                "absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full",
                badgeTone === "destructive" ? "bg-destructive" : "bg-copper",
              )}
              aria-hidden="true"
            />
          ) : null}
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
  const [sourcesSheetOpen, setSourcesSheetOpen] = useState(false)
  const [memorySheetOpen, setMemorySheetOpen] = useState(false)
  const [secretaryOpen, setSecretaryOpen] = useState(false)
  const [plannerStatus, setPlannerStatus] = useState<PlannerUiStatus>("Idle")
  const [plannerSummary, setPlannerSummary] = useState("")
  const [plannerModel, setPlannerModel] = useState<ClaudePlannerModelKey>(DEFAULT_CLAUDE_PLANNER_MODEL_KEY)
  const [isPlannerModelHydrated, setIsPlannerModelHydrated] = useState(false)
  const [isScheduling, setIsScheduling] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [taskErrorMessage, setTaskErrorMessage] = useState("")

  const dashboard = viewState.status === "ready" ? viewState.dashboard : null
  const events = dashboard?.events ?? []
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
      const [dashboardData, calendarData] = await Promise.all([
        fetchJson<DashboardResponse>("/api/dashboard", "Failed to load dashboard."),
        fetchJson<CalendarListResponse>("/api/calendars", "Failed to load calendars."),
      ])

      setViewState({ status: "ready", dashboard: dashboardData })
      setCalendars(sortCalendars(calendarData.calendars.map(toSidebarCalendar)))
      setTaskErrorMessage("")
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setViewState({ status: "signed-out" })
        setCalendars([])
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

  useEffect(() => {
    const storedModel = window.localStorage.getItem(PLANNER_MODEL_STORAGE_KEY)

    if (isClaudePlannerModelKey(storedModel)) {
      setPlannerModel(storedModel)
    }

    setIsPlannerModelHydrated(true)
  }, [])

  useEffect(() => {
    if (!isPlannerModelHydrated) {
      return
    }

    window.localStorage.setItem(PLANNER_MODEL_STORAGE_KEY, plannerModel)
  }, [isPlannerModelHydrated, plannerModel])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setSecretaryOpen((current) => !current)
      }
    }

    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [])

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
      const result = await fetchJson<TaskMutationResponse>(`/api/tasks/${taskId}`, "Failed to update task.", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      if (result.externalWrite?.status === "failed") {
        setTaskErrorMessage(result.externalWrite.error || result.externalWrite.summary)
      }
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

  async function handleUndoAutoImport(candidateId: string) {
    try {
      await fetchJson<{ success: true }>("/api/sources/candidates/undo", "Failed to undo auto-import.", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateIds: [candidateId] }),
      })
      await loadDashboard(true)
    } catch (error) {
      setTaskErrorMessage(error instanceof Error ? error.message : "Failed to undo auto-import.")
    }
  }

  function buildHardEventsForPlanning(taskIds: string[]) {
    const selectedTaskIds = new Set(taskIds)

    return events
      .filter((event) => !event.taskId || !selectedTaskIds.has(event.taskId))
      .filter((event) => !visibleCalendarIds || !event.calendarId || visibleCalendarIds.includes(event.calendarId))
      .map(toScheduleEventInput)
  }

  async function handleDailyPlan(command?: string) {
    if (isScheduling || !dashboard) {
      return
    }

    setIsScheduling(true)
    setPlannerStatus("Scheduling")
    setPlannerSummary("")

    try {
      const taskIds = dashboard.tasks.map((task) => task.id)
      const endpoint = command?.trim() ? "/api/daily-plan/replan" : "/api/daily-plan/build"
      const planResponse = await fetchJson<DailyPlanResponse>(endpoint, "Daily planning failed.", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: command?.trim() || null,
          hardEvents: buildHardEventsForPlanning(taskIds),
          plannerModel,
        }),
      })

      setPlannerStatus("Ready")
      setPlannerSummary(planResponse.dailyPlan.summary)
      await loadDashboard(true)
    } catch (error) {
      setPlannerStatus("Error")
      setPlannerSummary(error instanceof Error ? error.message : "Daily planning failed.")
    } finally {
      setIsScheduling(false)
    }
  }

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
          <div className="grid min-h-[560px] min-w-0 grid-cols-1 gap-4 xl:min-h-0 xl:grid-cols-[280px_minmax(0,1fr)] xl:gap-6 xl:pr-6">
            <DailyCommandStrip
              dailyPlan={dashboardData.dailyPlan}
              isPlanning={isScheduling}
              plannerStatus={plannerStatus}
              plannerSummary={plannerSummary}
              plannerModel={plannerModel}
              onPlannerModelChange={setPlannerModel}
              placement="side"
              onBuild={() => void handleDailyPlan()}
              onReplan={async (command) => {
                await handleDailyPlan(command)
              }}
            />
            <div className="min-h-0 min-w-0 flex-1">
              <ScheduleView
                calendars={calendars}
                visibleCalendarIds={visibleCalendarIds}
                events={dashboardData.events}
                tasks={dashboardData.tasks}
                onToggleTaskComplete={handleToggleTaskComplete}
                plannerStatus={plannerStatus}
                plannerSummary={plannerSummary}
                onSchedule={() => void handleDailyPlan()}
                isScheduling={isScheduling}
              />
            </div>
          </div>

          <div className="rail-scroll flex min-h-0 min-w-0 flex-col gap-5 overflow-y-auto pb-2 pt-6 xl:pb-2 xl:pl-6 xl:pr-1 xl:pt-0">
            <ContextRailPanel
              dailyPlan={dashboardData.dailyPlan}
              sources={dashboardData.sources}
              planStatus={plannerStatus}
              planError={plannerStatus === "Error" ? plannerSummary : ""}
              onRetry={() => void handleDailyPlan()}
              isRetrying={isScheduling}
            />
            <AutoImportDigest
              candidates={dashboardData.sourceCandidates}
              onUndo={handleUndoAutoImport}
            />
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
  const failedSources = dashboard?.sources.filter((source) => source.freshness === "failed").length ?? 0

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
              label={failedSources > 0 ? `Sources · ${failedSources} refresh issue${failedSources === 1 ? "" : "s"}` : "Sources"}
              icon={Database}
              onClick={() => setSourcesSheetOpen(true)}
              active={sourcesSheetOpen}
              badge={failedSources > 0}
              badgeTone="destructive"
            />
            <RailButton
              label={stats?.memories ? `Memory · ${stats.memories} notes` : "Memory"}
              icon={Brain}
              onClick={() => setMemorySheetOpen(true)}
              active={memorySheetOpen}
            />
            <RailButton
              label="Refresh"
              icon={RefreshCw}
              onClick={() => loadDashboard(true)}
              disabled={isRefreshing}
              spinning={isRefreshing}
            />
            <RailButton
              label="Build Today"
              icon={CalendarDays}
              onClick={() => void handleDailyPlan()}
              disabled={isScheduling || !dashboard}
              spinning={isScheduling}
            />
          </aside>

          <section className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-16 shrink-0 items-center gap-5 border-b border-rule-strong px-6">
              <div className="flex min-w-0 items-center gap-3">
                <span className="text-[17px] font-semibold leading-none text-foreground">
                  JARVIS
                </span>
                <span className="hidden h-4 w-px bg-rule-strong sm:block" />
                <span className="hidden text-[11px] font-medium uppercase text-muted-foreground sm:block">
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
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setSecretaryOpen(true)}
                      className="hidden h-8 items-center gap-2 rounded-sm border border-rule bg-secondary/30 px-2.5 text-[11px] uppercase text-muted-foreground transition-colors hover:border-rule-strong hover:text-foreground md:inline-flex"
                      aria-label="Open secretary"
                    >
                      <MessageSquare className="h-3.5 w-3.5 text-copper" aria-hidden="true" strokeWidth={1.75} />
                      <span className="num font-medium">Secretary</span>
                      <Kbd className="ml-1 h-4 px-1 text-[10px]">⌘K</Kbd>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={6} className="text-[11px]">
                    Talk to JARVIS
                  </TooltipContent>
                </Tooltip>
                <button
                  type="button"
                  onClick={() => setSecretaryOpen(true)}
                  aria-label="Open secretary"
                  className="flex h-9 w-9 items-center justify-center rounded-sm text-copper hover:bg-accent md:hidden"
                >
                  <MessageSquare className="h-[18px] w-[18px]" aria-hidden="true" />
                </button>
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

        <RailSheet
          isOpen={sourcesSheetOpen}
          onClose={() => setSourcesSheetOpen(false)}
          title="Sources"
          width={980}
        >
          {dashboard ? (
            <SourceSetupPanel
              sourceConnectors={dashboard.sourceConnectors}
              sources={dashboard.sources}
              sourceFiles={dashboard.sourceFiles}
              sourceCandidates={dashboard.sourceCandidates}
              onSourcesChanged={() => loadDashboard(true)}
            />
          ) : null}
        </RailSheet>

        <RailSheet
          isOpen={memorySheetOpen}
          onClose={() => setMemorySheetOpen(false)}
          title="Memory"
          width={980}
        >
          {dashboard ? (
            <MemoryPanel
              memories={dashboard.memories}
              onMemoriesChanged={() => loadDashboard(true)}
            />
          ) : null}
        </RailSheet>

        <SecretaryOverlay
          isOpen={secretaryOpen}
          onOpenChange={setSecretaryOpen}
          tasks={dashboard?.tasks ?? []}
        />
      </main>
    </TooltipProvider>
  )
}
