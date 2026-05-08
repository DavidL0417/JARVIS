// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { z } from "zod"

import {
  sourceCandidateSchema,
  sourceCandidateStatusSchema,
  sourceFileSummarySchema,
  sourceKindSchema,
  sourceSnapshotSummarySchema,
  taskSchema,
} from "@/schemas/common"

export const pasteSourceRequestSchema = z.object({
  source: sourceKindSchema.optional().default("manual"),
  sourceRef: z.string().trim().min(1).nullable().optional(),
  label: z.string().trim().min(1).nullable().optional(),
  text: z.string().trim().min(1),
})

export const sourceIntakeResponseSchema = z.object({
  success: z.literal(true),
  sourceSnapshot: sourceSnapshotSummarySchema,
  sourceFile: sourceFileSummarySchema.nullable(),
  candidates: z.array(sourceCandidateSchema),
})

export const updateCandidateRequestSchema = z.object({
  candidateIds: z.array(z.string().uuid()).min(1),
  status: sourceCandidateStatusSchema,
})

export const approveCandidatesRequestSchema = z.object({
  candidateIds: z.array(z.string().uuid()).min(1),
})

export const candidateListResponseSchema = z.object({
  success: z.literal(true),
  candidates: z.array(sourceCandidateSchema),
})

export const updateCandidateResponseSchema = candidateListResponseSchema

export const approveCandidatesResponseSchema = z.object({
  success: z.literal(true),
  tasks: z.array(taskSchema),
  candidates: z.array(sourceCandidateSchema),
})

export type PasteSourceRequest = z.infer<typeof pasteSourceRequestSchema>
export type SourceIntakeResponse = z.infer<typeof sourceIntakeResponseSchema>
export type UpdateCandidateRequest = z.infer<typeof updateCandidateRequestSchema>
export type ApproveCandidatesRequest = z.infer<typeof approveCandidatesRequestSchema>
export type CandidateListResponse = z.infer<typeof candidateListResponseSchema>
export type UpdateCandidateResponse = z.infer<typeof updateCandidateResponseSchema>
export type ApproveCandidatesResponse = z.infer<typeof approveCandidatesResponseSchema>

// ##### END BACKEND #####
