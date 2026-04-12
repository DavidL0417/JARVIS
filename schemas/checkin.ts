// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { z } from "zod"

import {
  checkInEnergySchema,
  checkInMoodSchema,
  prioritySchema,
  scheduleEventSchema,
} from "@/schemas/common"

export const checkInRequestSchema = z.object({
  mood: checkInMoodSchema.optional(),
  energy: checkInEnergySchema.optional(),
  completedTaskIds: z.array(z.string().uuid()).optional().default([]),
  blockers: z.array(z.string().trim().min(1)).optional().default([]),
  note: z.string().max(1000).optional(),
  activeTaskId: z.string().uuid().optional(),
})

export type CheckInRequest = z.infer<typeof checkInRequestSchema>

export const saveCheckInApprovalRequestSchema = z.object({
  eventId: z.string().uuid(),
  priority: prioritySchema,
  isImmutable: z.boolean(),
})

export const checkInApprovalItemSchema = z.object({
  event: scheduleEventSchema,
})

export const checkInApprovalListResponseSchema = z.object({
  success: z.literal(true),
  items: z.array(checkInApprovalItemSchema),
})

export const saveCheckInApprovalResponseSchema = z.object({
  success: z.literal(true),
  event: scheduleEventSchema,
})

// ##### END BACKEND #####
