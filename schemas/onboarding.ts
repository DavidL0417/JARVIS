// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { z } from "zod"

import {
  preferredCheckInModeSchema,
  prioritySchema,
  taskStatusSchema,
} from "@/schemas/common"

const tagSchema = z.string().trim().min(1)

export const onboardingPreferencesSchema = z.object({
  timezone: z.string().min(1).optional(),
  sleepPattern: z.string().min(1).nullable().optional(),
  peakEnergyWindow: z.string().min(1).nullable().optional(),
  procrastinationPattern: z.string().min(1).nullable().optional(),
  workdayStart: z.string().min(1).optional(),
  workdayEnd: z.string().min(1).optional(),
  defaultTaskDurationMinutes: z.number().int().positive().optional(),
  breakDurationMinutes: z.number().int().nonnegative().optional(),
  preferredFocusBlockMinutes: z.number().int().positive().nullable().optional(),
  preferredCheckInMode: preferredCheckInModeSchema.optional(),
  calendarId: z.string().min(1).nullable().optional(),
})

export const onboardingTaskInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1).nullable().optional(),
  deadline: z.string().datetime().nullable().optional(),
  durationMinutes: z.number().int().positive().nullable().optional(),
  priority: prioritySchema.optional(),
  status: taskStatusSchema.optional(),
  isImmutable: z.boolean().optional().default(false),
  calendarId: z.string().min(1).nullable().optional(),
  tags: z.array(tagSchema).optional().default([]),
})

export const onboardingRequestSchema = z.object({
  name: z.string().min(1),
  timezone: z.string().min(1),
  goals: z.array(z.string().trim().min(1)).optional().default([]),
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
