// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { z } from "zod"

import {
  calendarSourceSchema,
  calendarSyncPreferenceSchema,
  userCalendarSchema,
} from "@/schemas/common"

export const createCalendarRequestSchema = z.object({
  name: z.string().trim().min(1),
  color: z.string().trim().min(4).nullable().optional(),
  source: calendarSourceSchema.optional().default("local"),
  isImmutable: z.boolean(),
})

export const updateCalendarRequestSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    color: z.string().trim().min(4).optional(),
    isVisible: z.boolean().optional(),
    isImmutable: z.boolean().optional(),
    syncPreference: calendarSyncPreferenceSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one calendar field must be provided.",
  })

export const calendarMutationResponseSchema = z.object({
  success: z.literal(true),
  calendar: userCalendarSchema,
})

export const calendarListResponseSchema = z.object({
  success: z.literal(true),
  calendars: z.array(userCalendarSchema),
})

// ##### END BACKEND #####
