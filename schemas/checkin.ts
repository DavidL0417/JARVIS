// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { z } from "zod"

import { prioritySchema } from "@/schemas/common"

export const checkInRequestSchema = z.object({
  mood: z.enum(["good", "okay", "stuck"]).optional(),
  energy: prioritySchema.optional(),
  completedTaskIds: z.array(z.string().min(1)).optional().default([]),
  blockers: z.array(z.string().min(1)).optional().default([]),
  note: z.string().max(1000).optional(),
  activeTaskId: z.string().min(1).optional(),
})

export type CheckInRequest = z.infer<typeof checkInRequestSchema>

// ##### END BACKEND #####
