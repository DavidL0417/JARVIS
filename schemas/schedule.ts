// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { z } from "zod"

import { scheduleEventSchema, taskSchema, userPreferencesSchema } from "@/schemas/common"

export const scheduleRequestSchema = z.object({
  taskIds: z.array(z.string().uuid()).optional().default([]),
  hardEvents: z.array(scheduleEventSchema).optional().default([]),
})

export const schedulePreparationContextSchema = z.object({
  userId: z.string().uuid(),
  tasks: z.array(taskSchema),
  preferences: userPreferencesSchema.nullable(),
  hardEvents: z.array(scheduleEventSchema),
})

export const schedulePlanResultSchema = z.object({
  plannerStatus: z.enum(["stubbed", "ready"]),
  proposedEvents: z.array(scheduleEventSchema),
  unscheduledTaskIds: z.array(z.string().min(1)),
  summary: z.string().min(1),
})

export const scheduleResponseSchema = z.object({
  success: z.literal(true),
  message: z.string().min(1),
  context: z.object({
    userId: z.string().uuid(),
    taskCount: z.number().int().nonnegative(),
    hardEventCount: z.number().int().nonnegative(),
    hasPreferences: z.boolean(),
  }),
  schedule: schedulePlanResultSchema,
})

export type ScheduleRequest = z.infer<typeof scheduleRequestSchema>
export type SchedulePreparationContext = z.infer<typeof schedulePreparationContextSchema>
export type SchedulePlanResult = z.infer<typeof schedulePlanResultSchema>
export type ScheduleResponse = z.infer<typeof scheduleResponseSchema>

// ##### END BACKEND #####
