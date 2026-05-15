// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { z } from "zod"

import { CLAUDE_PLANNER_MODEL_OPTIONS } from "@/lib/ai/claude-models"
import { dailyPlanSchema, scheduleEventInputSchema, taskSchema } from "@/schemas/common"
import { schedulePlanResultSchema } from "@/schemas/schedule"

const claudePlannerModelKeys = CLAUDE_PLANNER_MODEL_OPTIONS.map((option) => option.key) as [
  (typeof CLAUDE_PLANNER_MODEL_OPTIONS)[number]["key"],
  ...(typeof CLAUDE_PLANNER_MODEL_OPTIONS)[number]["key"][],
]

export const claudePlannerModelSchema = z.enum(claudePlannerModelKeys)

export const dailyPlanBuildRequestSchema = z.object({
  command: z.string().trim().min(1).nullable().optional(),
  hardEvents: z.array(scheduleEventInputSchema).optional().default([]),
  plannerModel: claudePlannerModelSchema.optional(),
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
  plannerModel: claudePlannerModelSchema.optional(),
})

export const dailyPlanContextPreviewSchema = z.object({
  tasks: z.array(taskSchema),
})

export type DailyPlanBuildRequest = z.infer<typeof dailyPlanBuildRequestSchema>
export type DailyPlanResponse = z.infer<typeof dailyPlanResponseSchema>
export type DailyPlanReplanRequest = z.infer<typeof dailyPlanReplanRequestSchema>

// ##### END BACKEND #####
