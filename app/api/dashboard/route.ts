import { NextResponse } from "next/server"

import {
  DAILY_PLAN_SELECT,
  getCheckInModeFromCount,
  mapDailyPlanRowToDailyPlan,
  mapMemoryItemRowToSummary,
  mapScheduleEventRowToScheduleEvent,
  mapSourceCandidateRowToCandidate,
  mapSourceFileRowToSummary,
  mapSourceSnapshotRowToSummary,
  mapTaskRowToTask,
  SOURCE_CANDIDATE_SELECT,
  SOURCE_FILE_SELECT,
  MEMORY_ITEM_SELECT,
  SCHEDULE_EVENT_SELECT,
  SOURCE_SNAPSHOT_SELECT,
  TASK_SELECT,
} from "@/lib/data/mappers"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { dashboardResponseSchema } from "@/schemas/dashboard"
import type {
  DashboardResponse,
  DailyPlanRow,
  MemoryItemRow,
  ScheduleEventRow,
  SourceCandidateRow,
  SourceFileRow,
  SourceSnapshotRow,
  Task,
  TaskRow,
} from "@/types"

function pickCurrentTask(tasks: Task[]): DashboardResponse["currentTask"] {
  const scheduledTask = tasks.find((task) => task.status === "scheduled")

  if (scheduledTask) {
    return {
      id: scheduledTask.id,
      title: scheduledTask.title,
      status: scheduledTask.status,
    }
  }

  const todoTask = tasks.find((task) => task.status === "todo")

  if (!todoTask) {
    return null
  }

  return {
    id: todoTask.id,
    title: todoTask.title,
    status: todoTask.status,
  }
}

export async function GET() {
  try {
    const { adminClient, user } = await requireAuthenticatedUser()

    const [
      tasksResult,
      eventsResult,
      checkinsResult,
      memoryResult,
      sourceResult,
      sourceFileResult,
      sourceCandidateResult,
      dailyPlanResult,
    ] = await Promise.all([
      adminClient
        .from("tasks")
        .select(TASK_SELECT)
        .eq("user_id", user.id)
        .order("created_at", { ascending: true }),
      adminClient
        .from("schedule_events")
        .select(SCHEDULE_EVENT_SELECT)
        .eq("user_id", user.id)
        .order("starts_at", { ascending: true }),
      adminClient.from("checkins").select("id").eq("user_id", user.id).limit(4),
      adminClient
        .from("memory_items")
        .select(MEMORY_ITEM_SELECT)
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(8),
      adminClient
        .from("source_snapshots")
        .select(SOURCE_SNAPSHOT_SELECT)
        .eq("user_id", user.id)
        .order("captured_at", { ascending: false })
        .limit(8),
      adminClient
        .from("source_files")
        .select(SOURCE_FILE_SELECT)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(8),
      adminClient
        .from("source_candidates")
        .select(SOURCE_CANDIDATE_SELECT)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(12),
      adminClient
        .from("daily_plans")
        .select(DAILY_PLAN_SELECT)
        .eq("user_id", user.id)
        .neq("status", "superseded")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<DailyPlanRow>(),
    ])

    if (
      tasksResult.error ||
      eventsResult.error ||
      checkinsResult.error ||
      memoryResult.error ||
      sourceResult.error ||
      sourceFileResult.error ||
      sourceCandidateResult.error ||
      dailyPlanResult.error
    ) {
      throw new Error(
        tasksResult.error?.message ||
          eventsResult.error?.message ||
          checkinsResult.error?.message ||
          memoryResult.error?.message ||
          sourceResult.error?.message ||
          sourceFileResult.error?.message ||
          sourceCandidateResult.error?.message ||
          dailyPlanResult.error?.message ||
          "Failed to load dashboard data from Supabase.",
      )
    }

    const tasks = (tasksResult.data || []).map((row) => mapTaskRowToTask(row as TaskRow))
    const events = (eventsResult.data || [])
      .map((row) => mapScheduleEventRowToScheduleEvent(row as ScheduleEventRow))
      .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime())
    const memories = (memoryResult.data || []).map((row) => mapMemoryItemRowToSummary(row as MemoryItemRow))
    const sources = (sourceResult.data || []).map((row) => mapSourceSnapshotRowToSummary(row as SourceSnapshotRow))
    const sourceFiles = (sourceFileResult.data || []).map((row) => mapSourceFileRowToSummary(row as SourceFileRow))
    const sourceCandidates = (sourceCandidateResult.data || []).map((row) =>
      mapSourceCandidateRowToCandidate(row as SourceCandidateRow),
    )
    const dailyPlan = dailyPlanResult.data ? mapDailyPlanRowToDailyPlan(dailyPlanResult.data) : null
    const scheduledTaskIds = new Set(
      (eventsResult.data || [])
        .map((event) => (event as { task_id: string | null }).task_id)
        .filter((taskId): taskId is string => typeof taskId === "string" && taskId.length > 0),
    )

    const overdueCount = tasks.filter((task) => {
      if (task.status === "missed") {
        return true
      }

      if (!task.deadline || task.status === "completed") {
        return false
      }

      return new Date(task.deadline).getTime() < Date.now()
    }).length

    const unscheduledCount = tasks.filter((task) => {
      if (task.status === "completed" || task.status === "missed") {
        return false
      }

      return !task.scheduledFor && !scheduledTaskIds.has(task.id)
    }).length

    const dashboardPayload: DashboardResponse = {
      stats: {
        tasks: tasks.length,
        overdue: overdueCount,
        unscheduled: unscheduledCount,
        checkInMode: getCheckInModeFromCount((checkinsResult.data || []).length),
        memories: memories.length,
        sources: sources.length,
      },
      currentTask: pickCurrentTask(tasks),
      tasks,
      events,
      memories,
      sources,
      sourceFiles,
      sourceCandidates,
      dailyPlan,
    }

    const parsedPayload = dashboardResponseSchema.safeParse(dashboardPayload)

    if (!parsedPayload.success) {
      return NextResponse.json(
        {
          error: "Invalid dashboard response payload",
          issues: parsedPayload.error.flatten(),
        },
        { status: 500 },
      )
    }

    return NextResponse.json(parsedPayload.data)
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to load dashboard data.",
        details: error instanceof Error ? error.message : "Unknown dashboard error.",
      },
      { status: 500 },
    )
  }
}
