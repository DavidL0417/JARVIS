// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { z } from "zod"

import { preferredCheckInModeSchema, scheduleEventSchema, taskSchema, taskStatusSchema } from "@/schemas/common"

export const dashboardStatsSchema = z.object({
  tasks: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
  unscheduled: z.number().int().nonnegative(),
  checkInMode: preferredCheckInModeSchema,
})

export const dashboardCurrentTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  status: taskStatusSchema,
})

export const dashboardResponseSchema = z.object({
  stats: dashboardStatsSchema,
  currentTask: dashboardCurrentTaskSchema.nullable(),
  events: z.array(scheduleEventSchema),
  tasks: z.array(taskSchema),
})

export type DashboardResponseInput = z.infer<typeof dashboardResponseSchema>

// ##### END BACKEND #####
