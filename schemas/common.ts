// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { z } from "zod"

export const prioritySchema = z.enum(["low", "medium", "high"])

export const taskStatusSchema = z.enum(["todo", "scheduled", "completed", "missed"])

export const checkInStatusSchema = z.enum(["silent", "quiet", "gentle", "active"])

const hhmmPattern = /^([01]\d|2[0-3]):([0-5]\d)$/

export const userPreferencesSchema = z.object({
  timezone: z.string().min(1),
  sleepPattern: z.string().min(1).optional(),
  peakEnergyWindow: z.string().min(1).optional(),
  procrastinationPattern: z.string().min(1).optional(),
  workdayStart: z.string().regex(hhmmPattern, "Expected HH:MM time"),
  workdayEnd: z.string().regex(hhmmPattern, "Expected HH:MM time"),
  defaultTaskDurationMinutes: z.number().int().positive(),
  breakDurationMinutes: z.number().int().nonnegative(),
  calendarId: z.string().min(1).optional(),
  preferredFocusBlockMinutes: z.number().int().positive().optional(),
  preferredCheckInMode: checkInStatusSchema.optional(),
})

export const taskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  priority: prioritySchema,
  status: taskStatusSchema,
  dueAt: z.string().datetime().nullable().optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
  estimateMinutes: z.number().int().positive().nullable().optional(),
  tags: z.array(z.string().min(1)).optional().default([]),
})

export const scheduleEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  start: z.string().datetime(),
  end: z.string().datetime(),
  source: z.enum(["task", "calendar", "focus"]),
  status: taskStatusSchema.optional(),
  location: z.string().min(1).nullable().optional(),
})

// ##### END BACKEND #####
