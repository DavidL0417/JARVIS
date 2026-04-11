// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { z } from "zod"

import { checkInEnergySchema, checkInMoodSchema } from "@/schemas/common"

export const checkInRequestSchema = z.object({
  mood: checkInMoodSchema.optional(),
  energy: checkInEnergySchema.optional(),
  completedTaskIds: z.array(z.string().uuid()).optional().default([]),
  blockers: z.array(z.string().trim().min(1)).optional().default([]),
  note: z.string().max(1000).optional(),
  activeTaskId: z.string().uuid().optional(),
})

export type CheckInRequest = z.infer<typeof checkInRequestSchema>

// ##### END BACKEND #####
