// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { z } from "zod"

import { CLAUDE_PLANNER_MODEL_OPTIONS } from "@/lib/ai/claude-models"
import {
  memoryEntrySummarySchema,
  prioritySchema,
  scheduleEventInputSchema,
  scheduleEventSchema,
  sourceSnapshotSummarySchema,
  taskSchema,
  userPreferencesSchema,
} from "@/schemas/common"

const claudePlannerModelKeys = CLAUDE_PLANNER_MODEL_OPTIONS.map((option) => option.key) as [
  (typeof CLAUDE_PLANNER_MODEL_OPTIONS)[number]["key"],
  ...(typeof CLAUDE_PLANNER_MODEL_OPTIONS)[number]["key"][],
]

export const claudePlannerModelSchema = z.enum(claudePlannerModelKeys)

export const scheduleRequestSchema = z.object({
  taskIds: z.array(z.string().uuid()).optional().default([]),
  hardEvents: z.array(scheduleEventInputSchema).optional().default([]),
  plannerModel: claudePlannerModelSchema.optional(),
})

export const schedulePreparationContextSchema = z.object({
  userId: z.string().uuid(),
  tasks: z.array(taskSchema),
  preferences: userPreferencesSchema.nullable(),
  hardEvents: z.array(scheduleEventSchema),
  memoryEntries: z.array(memoryEntrySummarySchema).optional(),
  sourceSnapshots: z.array(sourceSnapshotSummarySchema).optional(),
  command: z.string().trim().min(1).nullable().optional(),
  layeredContextMarkdown: z.string().trim().min(1).nullable().optional(),
  sourceStatus: z.array(z.object({
    label: z.string().min(1),
    status: z.union([z.enum(["fresh", "partial", "stale", "failed"]), z.enum(["connected", "missing"])]),
    detail: z.string().min(1),
  })).optional(),
  plannerTradeoffContext: z.array(z.string().min(1)).optional(),
})

export const schedulePlanResultSchema = z.object({
  plannerStatus: z.enum(["stubbed", "ready"]),
  proposedEvents: z.array(scheduleEventSchema),
  unscheduledTaskIds: z.array(z.string().uuid()),
  summary: z.string().min(1),
  tradeoffNotes: z.array(z.string().min(1)).default([]),
})

export const scheduleResponseSchema = z.object({
  success: z.literal(true),
  message: z.string().min(1),
  context: z.object({
    userId: z.string().uuid(),
    taskCount: z.number().int().nonnegative(),
    hardEventCount: z.number().int().nonnegative(),
    hasPreferences: z.boolean(),
  }),
  schedule: schedulePlanResultSchema,
})

export const scheduleEventUpdateRequestSchema = z
  .object({
    priority: prioritySchema.optional(),
    isImmutable: z.boolean().optional(),
    // Confirm a provisional imported event ("JARVIS added this"). The route
    // already marks any edited event checked-in, so this lets the operator
    // confirm without changing anything else.
    isCheckedIn: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.priority !== undefined || value.isImmutable !== undefined || value.isCheckedIn !== undefined,
    {
      message: "At least one event setting must be provided.",
    },
  )

export const scheduleEventUpdateResponseSchema = z.object({
  success: z.literal(true),
  event: scheduleEventSchema,
})

export type ScheduleRequest = z.infer<typeof scheduleRequestSchema>
export type SchedulePreparationContext = z.infer<typeof schedulePreparationContextSchema>
export type SchedulePlanResult = z.infer<typeof schedulePlanResultSchema>
export type ScheduleResponse = z.infer<typeof scheduleResponseSchema>
export type ScheduleEventUpdateRequest = z.infer<typeof scheduleEventUpdateRequestSchema>
export type ScheduleEventUpdateResponse = z.infer<typeof scheduleEventUpdateResponseSchema>

// ##### END BACKEND #####
