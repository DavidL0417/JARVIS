import { z } from "zod"

import { riskDecisionSchema, riskTypeSchema } from "@/schemas/common"

export const riskDecisionActionSchema = z.enum(["snooze", "dismiss"])

export const createRiskDecisionRequestSchema = z.object({
  riskType: riskTypeSchema,
  subjectKey: z.string().min(1),
  // Only persisted for task-scoped risks (FK to tasks); ignored otherwise.
  taskId: z.string().uuid().nullable().optional(),
  action: riskDecisionActionSchema,
  // Snooze window override in minutes; defaults to 24h server-side. Capped at 30 days.
  snoozeMinutes: z
    .number()
    .int()
    .positive()
    .max(60 * 24 * 30)
    .optional(),
})

export const riskDecisionResponseSchema = z.object({
  success: z.literal(true),
  decision: riskDecisionSchema,
})

// Un-park (un-snooze / un-dismiss): clears the decision so the risk can reappear.
export const deleteRiskDecisionRequestSchema = z.object({
  riskType: riskTypeSchema,
  subjectKey: z.string().min(1),
})

export const deleteRiskDecisionResponseSchema = z.object({
  success: z.literal(true),
})

export type CreateRiskDecisionRequest = z.infer<typeof createRiskDecisionRequestSchema>
export type RiskDecisionResponse = z.infer<typeof riskDecisionResponseSchema>
export type DeleteRiskDecisionRequest = z.infer<typeof deleteRiskDecisionRequestSchema>
