import { z } from "zod"

import {
  dailyPlanSchema,
  memoryEntrySummarySchema,
  preferredCheckInModeSchema,
  sourceSnapshotSummarySchema,
} from "@/schemas/common"

export const assistantToolStatusSchema = z.enum(["completed", "clarification", "error", "pending_approval", "cancelled"])

export const assistantToolCallResultSchema = z.object({
  id: z.string().min(1),
  tool: z.string().min(1),
  status: assistantToolStatusSchema,
  summary: z.string().min(1),
  requiresApproval: z.boolean().optional(),
  errorMessage: z.string().min(1).nullable().optional(),
})

export const availabilityContextSchema = z.object({
  timezone: z.string().min(1),
  workdayStart: z.string().min(1),
  workdayEnd: z.string().min(1),
  peakEnergyWindow: z.string().nullable(),
  sleepPattern: z.string().nullable(),
  procrastinationPattern: z.string().nullable(),
  preferredCheckInMode: preferredCheckInModeSchema,
  defaultTaskDurationMinutes: z.number().int().positive(),
  breakDurationMinutes: z.number().int().nonnegative(),
  preferredFocusBlockMinutes: z.number().int().positive().nullable(),
  availabilitySummary: z.string().min(1),
})

export const assistantContextDataSchema = z.object({
  availability: availabilityContextSchema,
  availabilityWindows: z.array(
    z.object({
      start: z.string().datetime({ offset: true }),
      end: z.string().datetime({ offset: true }),
      localDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      durationMinutes: z.number().int().nonnegative(),
    }),
  ),
  memoryEntries: z.array(memoryEntrySummarySchema),
  sourceSnapshots: z.array(sourceSnapshotSummarySchema),
  memorySummary: z.string().min(1),
  layeredContextMarkdown: z.string().min(1).optional(),
  latestDailyPlan: dailyPlanSchema.nullable().optional(),
  pendingCandidateCount: z.number().int().nonnegative().optional(),
  recentChangeLogSummaries: z.array(z.string().min(1)).optional(),
})

export const assistantConversationEntrySchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().trim().min(1),
})

export const assistantMessageRequestSchema = z.object({
  message: z.string().trim().min(1, "Message is required."),
  now: z.string().datetime().nullable().optional(),
  timezone: z.string().trim().min(1).nullable().optional(),
  history: z.array(assistantConversationEntrySchema).optional().default([]),
})

export const assistantMessageResponseSchema = z.object({
  ok: z.boolean(),
  reply: z.string().min(1),
  toolCalls: z.array(assistantToolCallResultSchema),
  needsRefresh: z.boolean(),
  clarification: z.string().nullable(),
  context: assistantContextDataSchema.optional(),
  error: z.string().optional(),
  debug: z
    .object({
      steps: z.array(z.string()).optional(),
      lastToolName: z.string().optional(),
      model: z.string().optional(),
    })
    .optional(),
})

export const assistantContextResponseSchema = z.object({
  ok: z.boolean(),
  context: assistantContextDataSchema,
  error: z.string().optional(),
})

export type AssistantMessageRequestInput = z.infer<typeof assistantMessageRequestSchema>
export type AssistantToolCallResultInput = z.infer<typeof assistantToolCallResultSchema>
export type AssistantContextDataInput = z.infer<typeof assistantContextDataSchema>
export type AssistantMessageResponseInput = z.infer<typeof assistantMessageResponseSchema>
export type AssistantContextResponseInput = z.infer<typeof assistantContextResponseSchema>
export type AssistantConversationEntryInput = z.infer<typeof assistantConversationEntrySchema>
