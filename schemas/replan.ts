// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { z } from "zod"

import { scheduleEventSchema, taskSchema, userPreferencesSchema } from "@/schemas/common"

export const replanRequestSchema = z.object({
  reason: z.string().min(1),
  pendingTasks: z.array(taskSchema).optional().default([]),
  existingEvents: z.array(scheduleEventSchema).optional().default([]),
  preferences: userPreferencesSchema.optional(),
})

export type ReplanRequest = z.infer<typeof replanRequestSchema>

// ##### END BACKEND #####
