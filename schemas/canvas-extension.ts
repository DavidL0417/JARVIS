import { z } from "zod"

import { sourceCandidateSchema } from "@/schemas/common"

const canvasUrlSchema = z.string().url().refine((value) => {
  const url = new URL(value)
  return url.protocol === "https:" || (process.env.NODE_ENV !== "production" && url.hostname === "localhost")
}, "Canvas URLs must use HTTPS.")

export const canvasExtensionLinkSchema = z.object({
  url: canvasUrlSchema,
  text: z.string().trim().max(180).nullable(),
  kindHint: z.string().trim().max(80).nullable().optional(),
})

export const canvasExtensionPagePreviewLinkSchema = z.object({
  url: canvasUrlSchema,
  text: z.string().trim().max(180).nullable(),
})

export const canvasExtensionPagePreviewBlockSchema = z.object({
  id: z.string().trim().min(1).max(80),
  type: z.enum(["text", "links", "mixed"]),
  title: z.string().trim().max(180).nullable(),
  text: z.string().trim().max(16_000).nullable(),
  html: z.string().trim().max(60_000).nullable(),
  links: z.array(canvasExtensionPagePreviewLinkSchema).max(80),
  order: z.number().int().nonnegative(),
  truncated: z.boolean().optional(),
})

export const canvasExtensionPagePreviewSchema = z.object({
  html: z.string().trim().min(1).max(120_000),
  links: z.array(canvasExtensionPagePreviewLinkSchema).max(120),
  blocks: z.array(canvasExtensionPagePreviewBlockSchema).max(80).optional(),
  capturedAt: z.string().datetime({ offset: true }),
  truncated: z.boolean().optional(),
})

export const canvasExtensionCourseRowSchema = z.object({
  url: canvasUrlSchema,
  title: z.string().trim().min(1).max(240),
  courseId: z.string().trim().min(1).max(40),
  group: z.string().trim().min(1).max(120).nullable().optional(),
  term: z.string().trim().max(120).nullable().optional(),
  enrolledAs: z.string().trim().max(120).nullable().optional(),
  published: z.string().trim().max(40).nullable().optional(),
})

export const canvasExtensionPageSnapshotSchema = z.object({
  scanId: z.string().trim().min(8).max(120),
  canvasOrigin: z.string().url(),
  url: canvasUrlSchema,
  title: z.string().trim().min(1).max(240),
  courseHint: z.string().trim().min(1).max(180).nullable(),
  pageKindHint: z.string().trim().min(1).max(80).nullable(),
  visibleText: z.string().trim().min(1).max(60_000),
  links: z.array(canvasExtensionLinkSchema).max(250),
  courseNavLinks: z.array(canvasExtensionLinkSchema).max(100).optional(),
  pageItemLinks: z.array(canvasExtensionLinkSchema).max(250).optional(),
  courseRows: z.array(canvasExtensionCourseRowSchema).max(500).optional(),
  pagePreview: canvasExtensionPagePreviewSchema.optional(),
  capturedAt: z.string().datetime({ offset: true }),
}).superRefine((value, context) => {
  const origin = new URL(value.canvasOrigin).origin
  const pageOrigin = new URL(value.url).origin

  if (origin !== pageOrigin) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Canvas page URL must match the declared Canvas origin.",
      path: ["url"],
    })
  }

  value.pagePreview?.links.forEach((link, index) => {
    if (new URL(link.url).origin !== origin) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Canvas preview links must match the declared Canvas origin.",
        path: ["pagePreview", "links", index, "url"],
      })
    }
  })
})

export const canvasExtensionPairingCodeResponseSchema = z.object({
  success: z.literal(true),
  code: z.string().min(8),
  expiresAt: z.string().datetime({ offset: true }),
})

export const canvasExtensionPairRequestSchema = z.object({
  code: z.string().trim().min(8),
  canvasOrigin: z.string().url().nullable().optional(),
  extensionVersion: z.string().trim().max(40).nullable().optional(),
})

export const canvasExtensionPairResponseSchema = z.object({
  success: z.literal(true),
  extensionToken: z.string().min(32),
  expiresAt: z.null(),
})

export const canvasExtensionImportPageRequestSchema = canvasExtensionPageSnapshotSchema

export const canvasExtensionCrawlLedgerItemSchema = z.object({
  url: z.string().url(),
  status: z.enum(["imported", "skipped", "failed"]),
  reason: z.string().trim().min(1),
  candidateCount: z.number().int().nonnegative(),
})

export const canvasExtensionExtractionResultSchema = z.object({
  summary: z.string().trim().min(1),
  pageKind: z.string().trim().min(1).nullable(),
  confidence: z.number().min(0).max(1),
  skippedReason: z.string().trim().min(1).nullable(),
  candidates: z.array(sourceCandidateSchema.pick({
    kind: true,
    title: true,
    description: true,
    course: true,
    dueAt: true,
    durationMinutes: true,
    priority: true,
    confidence: true,
    evidence: true,
  })),
})

export const canvasExtensionImportPageResponseSchema = z.object({
  success: z.literal(true),
  sourceSnapshotId: z.string().uuid(),
  candidates: z.array(sourceCandidateSchema),
  ledgerItem: canvasExtensionCrawlLedgerItemSchema,
})

export const canvasExtensionNodeKindSchema = z.enum([
  "course",
  "section",
  "page",
  "assignment",
  "module",
  "file",
  "discussion",
  "calendar",
  "external_link",
  "unknown",
])

export const canvasExtensionCommandTypeSchema = z.enum(["discover", "expand_node", "import_selected", "capture_url"])
export const canvasExtensionCommandStatusSchema = z.enum([
  "pending",
  "running",
  "cancel_requested",
  "succeeded",
  "failed",
  "cancelled",
])

export const canvasExtensionSessionSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["connected", "disconnected", "error"]),
  extensionVersion: z.string().min(1).nullable(),
  canvasOrigin: z.string().min(1).nullable(),
  activeUrl: z.string().min(1).nullable(),
  activeTitle: z.string().min(1).nullable(),
  activeCommandId: z.string().uuid().nullable(),
  lastSeenAt: z.string().datetime({ offset: true }),
})

export const canvasExtensionNodeSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  canvasOrigin: z.string().min(1),
  url: z.string().url(),
  title: z.string().min(1),
  kind: canvasExtensionNodeKindSchema,
  textPreview: z.string().min(1).nullable(),
  metadata: z.record(z.unknown()),
  selected: z.boolean(),
  expanded: z.boolean(),
  importedAt: z.string().datetime({ offset: true }).nullable(),
  sourceSnapshotId: z.string().uuid().nullable(),
  sourceFileId: z.string().uuid().nullable(),
  discoveredAt: z.string().datetime({ offset: true }),
})

export const canvasExtensionCommandSchema = z.object({
  id: z.string().uuid(),
  type: canvasExtensionCommandTypeSchema,
  status: canvasExtensionCommandStatusSchema,
  targetNodeId: z.string().uuid().nullable(),
  payload: z.record(z.unknown()),
  result: z.record(z.unknown()),
  errorMessage: z.string().min(1).nullable(),
  startedAt: z.string().datetime({ offset: true }).nullable(),
  completedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
})

export const canvasExtensionCommandEventSchema = z.object({
  id: z.string().uuid(),
  commandId: z.string().uuid().nullable(),
  userId: z.string().uuid(),
  level: z.enum(["info", "success", "warning", "error"]),
  phase: z.string().min(1).max(80),
  nodeId: z.string().uuid().nullable(),
  message: z.string().min(1),
  details: z.record(z.unknown()),
  createdAt: z.string().datetime({ offset: true }),
})

export const canvasExtensionHealthSchema = z.object({
  authStatus: z.enum(["signed_in", "auth_required", "backend_timeout", "backend_error"]),
  extensionStatus: z.enum(["connected", "stale", "offline", "unknown"]),
  activeCommand: canvasExtensionCommandSchema.nullable(),
  lastEvent: canvasExtensionCommandEventSchema.nullable(),
  recoverableActions: z.array(z.enum([
    "sign_in",
    "retry_state",
    "wake_extension",
    "open_canvas",
    "create_pairing_code",
    "reload_extension",
    "stop_command",
    "resume_import",
  ])),
})

export const canvasExtensionStateResponseSchema = z.object({
  success: z.literal(true),
  health: canvasExtensionHealthSchema,
  session: canvasExtensionSessionSchema.nullable(),
  commands: z.array(canvasExtensionCommandSchema),
  nodes: z.array(canvasExtensionNodeSchema),
  events: z.array(canvasExtensionCommandEventSchema),
})

export const canvasExtensionCreateCommandRequestSchema = z.object({
  type: z.enum(["discover", "expand_node", "import_selected", "capture_url", "stop", "resume"]),
  targetNodeId: z.string().uuid().nullable().optional(),
  nodeIds: z.array(z.string().uuid()).max(200).optional(),
  url: canvasUrlSchema.optional(),
})

export const canvasExtensionSelectNodeRequestSchema = z.object({
  nodeId: z.string().uuid(),
  selected: z.boolean(),
})

export const canvasExtensionWorkerPollRequestSchema = z.object({
  extensionVersion: z.string().trim().max(40).nullable().optional(),
  canvasOrigin: z.string().url().nullable().optional(),
  activeUrl: z.string().url().nullable().optional(),
  activeTitle: z.string().trim().max(240).nullable().optional(),
})

export const canvasExtensionWorkerNodeSchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  parentUrl: z.string().url().nullable().optional(),
  canvasOrigin: z.string().url(),
  url: z.string().url(),
  title: z.string().trim().min(1).max(240),
  kind: canvasExtensionNodeKindSchema,
  textPreview: z.string().trim().max(1200).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  selected: z.boolean().optional(),
  expanded: z.boolean().optional(),
})

export const canvasExtensionWorkerReportRequestSchema = z.object({
  commandId: z.string().uuid(),
  status: z.enum(["progress", "succeeded", "failed", "cancelled"]),
  level: z.enum(["info", "success", "warning", "error"]).optional(),
  phase: z.string().trim().min(1).max(80).optional(),
  nodeId: z.string().uuid().nullable().optional(),
  message: z.string().trim().max(1000).nullable().optional(),
  details: z.record(z.unknown()).optional(),
  nodes: z.array(canvasExtensionWorkerNodeSchema).max(500).optional(),
  importedNodes: z.array(z.object({
    nodeId: z.string().uuid(),
    sourceSnapshotId: z.string().uuid().nullable().optional(),
    sourceFileId: z.string().uuid().nullable().optional(),
    importedAt: z.string().datetime({ offset: true }).optional(),
    errorMessage: z.string().trim().max(1000).nullable().optional(),
  })).max(200).optional(),
  result: z.record(z.unknown()).optional(),
})

export const canvasExtensionImportFileMetadataSchema = z.object({
  nodeId: z.string().uuid().nullable().optional(),
  canvasOrigin: z.string().url(),
  url: z.string().url(),
  title: z.string().trim().min(1).max(240),
  fileName: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().min(1).max(120),
  sizeBytes: z.number().int().nonnegative(),
  metadataOnly: z.boolean().optional().default(false),
  reason: z.string().trim().max(500).nullable().optional(),
})

export type CanvasExtensionPageSnapshot = z.infer<typeof canvasExtensionPageSnapshotSchema>
export type CanvasExtensionExtractionResult = z.infer<typeof canvasExtensionExtractionResultSchema>
export type CanvasExtensionPairingCodeResponse = z.infer<typeof canvasExtensionPairingCodeResponseSchema>
export type CanvasExtensionImportPageResponse = z.infer<typeof canvasExtensionImportPageResponseSchema>
export type CanvasExtensionNode = z.infer<typeof canvasExtensionNodeSchema>
export type CanvasExtensionCommand = z.infer<typeof canvasExtensionCommandSchema>
export type CanvasExtensionSession = z.infer<typeof canvasExtensionSessionSchema>
export type CanvasExtensionCommandEvent = z.infer<typeof canvasExtensionCommandEventSchema>
export type CanvasExtensionHealth = z.infer<typeof canvasExtensionHealthSchema>
export type CanvasExtensionStateResponse = z.infer<typeof canvasExtensionStateResponseSchema>
