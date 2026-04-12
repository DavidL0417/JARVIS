// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { z } from "zod"

export const prioritySchema = z.enum(["low", "medium", "high"])
export const taskStatusSchema = z.enum(["todo", "scheduled", "completed", "missed"])
export const preferredCheckInModeSchema = z.enum(["silent", "quiet", "gentle", "active"])
export const scheduleEventSourceSchema = z.enum(["task", "calendar", "focus"])
export const checkInMoodSchema = z.enum(["good", "okay", "stuck"])
export const checkInOutcomeSchema = z.enum(["completed", "missed", "partial"])
export const checkInEnergySchema = z.enum(["low", "medium", "high"])

const hhmmPattern = /^([01]\d|2[0-3]):([0-5]\d)$/
const tagSchema = z.string().trim().min(1)
//hi
// App-facing schemas mirror camelCase shared models. Raw Supabase rows stay in `types/index.ts`.
export const userPreferencesSchema = z.object({
  userId: z.string().uuid(),
  timezone: z.string().min(1),
  sleepPattern: z.string().min(1).nullable(),
  peakEnergyWindow: z.string().min(1).nullable(),
  procrastinationPattern: z.string().min(1).nullable(),
  workdayStart: z.string().regex(hhmmPattern, "Expected HH:MM time"),
  workdayEnd: z.string().regex(hhmmPattern, "Expected HH:MM time"),
  defaultTaskDurationMinutes: z.number().int().positive(),
  breakDurationMinutes: z.number().int().nonnegative(),
  preferredFocusBlockMinutes: z.number().int().positive().nullable(),
  preferredCheckInMode: preferredCheckInModeSchema,
  calendarId: z.string().min(1).nullable(),
})

export const taskSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().min(1).nullable(),
  deadline: z.string().datetime({ offset: true }).nullable(),
  durationMinutes: z.number().int().positive().nullable(),
  priority: prioritySchema,
  status: taskStatusSchema,
  scheduledFor: z.string().datetime({ offset: true }).nullable(),
  isImmutable: z.boolean(),
  allDay: z.boolean(),
  calendarId: z.string().min(1).nullable(),
  tags: z.array(tagSchema),
})

export const scheduleEventSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  title: z.string().min(1),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  source: scheduleEventSourceSchema,
  status: taskStatusSchema.nullable(),
  location: z.string().min(1).nullable(),
  externalEventId: z.string().min(1).nullable(),
  isImmutable: z.boolean(),
  allDay: z.boolean(),
  calendarId: z.string().min(1).nullable(),
})

export const scheduleEventInputSchema = scheduleEventSchema.omit({ userId: true }).extend({
  userId: z.string().uuid().optional(),
  allDay: z.boolean().optional().default(false),
})

// ##### END BACKEND #####
