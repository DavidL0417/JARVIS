import { z } from "zod"

import { scheduleEventSchema, taskSchema, userPreferencesSchema } from "@/schemas/common"

export const scheduleRequestSchema = z.object({
  tasks: z.array(taskSchema).min(1),
  preferences: userPreferencesSchema,
  hardEvents: z.array(scheduleEventSchema).optional().default([]),
})

export type ScheduleRequest = z.infer<typeof scheduleRequestSchema>
