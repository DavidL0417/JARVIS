import { z } from "zod"

import {
  memoryEntrySummarySchema,
  dailyPlanSchema,
  preferredCheckInModeSchema,
  scheduleEventSchema,
  sourceConnectorSchema,
  sourceCandidateSchema,
  sourceFileSummarySchema,
  sourceSnapshotSummarySchema,
  taskSchema,
  taskStatusSchema,
  userIntegrationSchema,
} from "@/schemas/common"

export const dashboardStatsSchema = z.object({
  tasks: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
  unscheduled: z.number().int().nonnegative(),
  checkInMode: preferredCheckInModeSchema,
  memories: z.number().int().nonnegative(),
  sources: z.number().int().nonnegative(),
})

export const dashboardCurrentTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  status: taskStatusSchema,
})

export const dashboardReentrySchema = z.object({
  gapDays: z.number().int().nonnegative(),
  unconfirmedCount: z.number().int().nonnegative(),
  tasksReturnedToTodo: z.number().int().nonnegative(),
  autoImportedCount: z.number().int().nonnegative(),
  passedDeadlines: z.array(z.string()),
})

export const dashboardResponseSchema = z.object({
  stats: dashboardStatsSchema,
  currentTask: dashboardCurrentTaskSchema.nullable(),
  tasks: z.array(taskSchema),
  events: z.array(scheduleEventSchema),
  memories: z.array(memoryEntrySummarySchema),
  integrations: z.array(userIntegrationSchema),
  sourceConnectors: z.array(sourceConnectorSchema),
  sources: z.array(sourceSnapshotSummarySchema),
  sourceFiles: z.array(sourceFileSummarySchema),
  sourceCandidates: z.array(sourceCandidateSchema),
  dailyPlan: dailyPlanSchema.nullable(),
  reentry: dashboardReentrySchema.nullable().optional(),
  // Only true for the operator account — gates the hidden iMessage console pane.
  isImessageOperator: z.boolean().optional(),
  // Only true for the operator account — gates the hidden Raycast status pane.
  isRaycastOperator: z.boolean().optional(),
})

export type DashboardResponseInput = z.infer<typeof dashboardResponseSchema>
