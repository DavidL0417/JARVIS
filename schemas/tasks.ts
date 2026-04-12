// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { z } from "zod"

import { prioritySchema, taskSchema, taskStatusSchema } from "@/schemas/common"

const taskTagSchema = z.string().trim().min(1)

export const createTaskRequestSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1).nullable().optional(),
  deadline: z.string().datetime().nullable().optional(),
  durationMinutes: z.number().int().positive().nullable().optional(),
  priority: prioritySchema.optional(),
  status: taskStatusSchema.optional(),
  isImmutable: z.boolean().optional(),
  calendarId: z.string().trim().min(1).nullable().optional(),
  tags: z.array(taskTagSchema).optional().default([]),
  scheduledFor: z.string().datetime().nullable().optional(),
})

export const updateTaskRequestSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).nullable().optional(),
    deadline: z.string().datetime().nullable().optional(),
    durationMinutes: z.number().int().positive().nullable().optional(),
    priority: prioritySchema.optional(),
    status: taskStatusSchema.optional(),
    isImmutable: z.boolean().optional(),
    calendarId: z.string().trim().min(1).nullable().optional(),
    tags: z.array(taskTagSchema).optional(),
    scheduledFor: z.string().datetime().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one task field must be provided.",
  })

export const taskMutationResponseSchema = z.object({
  success: z.literal(true),
  task: taskSchema,
})

export const deleteTaskResponseSchema = z.object({
  success: z.literal(true),
  id: z.string().uuid(),
})

// ##### END BACKEND #####
