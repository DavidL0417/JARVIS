// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { z } from "zod"

import { checkInStatusSchema, scheduleEventSchema, taskStatusSchema } from "@/schemas/common"

export const dashboardStatsSchema = z.object({
  tasks: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
  unscheduled: z.number().int().nonnegative(),
  checkins: checkInStatusSchema,
})

export const dashboardCurrentTaskSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  status: taskStatusSchema,
})

export const dashboardResponseSchema = z.object({
  stats: dashboardStatsSchema,
  currentTask: dashboardCurrentTaskSchema.nullable(),
  events: z.array(scheduleEventSchema),
})

export type DashboardResponseInput = z.infer<typeof dashboardResponseSchema>

// ##### END BACKEND #####
