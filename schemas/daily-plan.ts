// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { z } from "zod"

import { dailyPlanSchema, scheduleEventInputSchema, taskSchema } from "@/schemas/common"
import { schedulePlanResultSchema } from "@/schemas/schedule"

export const dailyPlanBuildRequestSchema = z.object({
  command: z.string().trim().min(1).nullable().optional(),
  hardEvents: z.array(scheduleEventInputSchema).optional().default([]),
})

export const dailyPlanResponseSchema = z.object({
  success: z.literal(true),
  dailyPlan: dailyPlanSchema,
  schedule: schedulePlanResultSchema,
  taskCount: z.number().int().nonnegative(),
})

export const dailyPlanReplanRequestSchema = z.object({
  command: z.string().trim().min(1),
  hardEvents: z.array(scheduleEventInputSchema).optional().default([]),
})

export const dailyPlanContextPreviewSchema = z.object({
  tasks: z.array(taskSchema),
})

export type DailyPlanBuildRequest = z.infer<typeof dailyPlanBuildRequestSchema>
export type DailyPlanResponse = z.infer<typeof dailyPlanResponseSchema>
export type DailyPlanReplanRequest = z.infer<typeof dailyPlanReplanRequestSchema>

// ##### END BACKEND #####
