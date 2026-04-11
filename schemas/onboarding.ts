// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { z } from "zod"

import { prioritySchema, taskStatusSchema, userPreferencesSchema } from "@/schemas/common"

export const onboardingPreferencesSchema = userPreferencesSchema.partial().extend({
  timezone: z.string().min(1).optional(),
})

export const onboardingTaskInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  deadline: z.string().datetime().nullable().optional(),
  durationMinutes: z.number().int().positive().nullable().optional(),
  priority: prioritySchema.optional(),
  status: taskStatusSchema.optional(),
})

export const onboardingRequestSchema = z.object({
  name: z.string().min(1),
  timezone: z.string().min(1),
  goals: z.array(z.string().min(1)).optional().default([]),
  tasks: z.array(onboardingTaskInputSchema).optional().default([]),
  preferences: onboardingPreferencesSchema.optional(),
})

export const onboardingResponseSchema = z.object({
  success: z.literal(true),
  userId: z.string().uuid(),
  preferenceId: z.string().uuid().nullable(),
  taskIds: z.array(z.string().uuid()),
  taskCount: z.number().int().nonnegative(),
})

export type OnboardingRequest = z.infer<typeof onboardingRequestSchema>
export type OnboardingResponse = z.infer<typeof onboardingResponseSchema>

// ##### END BACKEND #####
