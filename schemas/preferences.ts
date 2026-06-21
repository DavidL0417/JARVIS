// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { z } from "zod"

import { preferredCheckInModeSchema, userPreferencesSchema } from "@/schemas/common"

const nullableTrimmedTextSchema = z.string().trim().min(1).nullable()
const hhmmSchema = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Expected HH:MM time")

export const updatePreferencesRequestSchema = z
  .object({
    timezone: z.string().trim().min(1).optional(),
    sleepPattern: nullableTrimmedTextSchema.optional(),
    peakEnergyWindow: nullableTrimmedTextSchema.optional(),
    procrastinationPattern: nullableTrimmedTextSchema.optional(),
    workdayStart: hhmmSchema.optional(),
    workdayEnd: hhmmSchema.optional(),
    defaultTaskDurationMinutes: z.number().int().positive().optional(),
    breakDurationMinutes: z.number().int().nonnegative().optional(),
    preferredFocusBlockMinutes: z.number().int().positive().nullable().optional(),
    preferredCheckInMode: preferredCheckInModeSchema.optional(),
    calendarId: nullableTrimmedTextSchema.optional(),
    plannerHorizonDays: z.number().int().min(7).max(56).optional(),
    morningDigestEnabled: z.boolean().optional(),
    eveningDigestEnabled: z.boolean().optional(),
    morningDigestTime: hhmmSchema.optional(),
    eveningDigestTime: hhmmSchema.optional(),
    quietHoursStart: hhmmSchema.nullable().optional(),
    quietHoursEnd: hhmmSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one preference field must be provided.",
  })

export const preferencesResponseSchema = z.object({
  success: z.literal(true),
  preferences: userPreferencesSchema,
})

// ##### END BACKEND #####
