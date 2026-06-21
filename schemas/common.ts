import { z } from "zod"

import { RISK_TYPES, type RiskType } from "@/lib/risk-types"

export const riskTypeSchema = z.enum([...RISK_TYPES] as [RiskType, ...RiskType[]])

export const prioritySchema = z.enum(["low", "medium", "high"])
export const taskStatusSchema = z.enum(["todo", "scheduled", "completed", "missed"])
export const scheduleEventStatusSchema = z.enum(["todo", "scheduled", "completed", "missed", "unconfirmed"])
export const preferredCheckInModeSchema = z.enum(["silent", "quiet", "gentle", "active"])
export const scheduleEventSourceSchema = z.enum(["task", "calendar", "focus", "imported"])
export const checkInMoodSchema = z.enum(["good", "okay", "stuck"])
export const checkInOutcomeSchema = z.enum(["completed", "missed", "partial"])
export const checkInEnergySchema = z.enum(["low", "medium", "high"])
export const syncOriginSchema = z.enum(["local", "gcal", "caldav"])
export const calendarSourceSchema = z.enum(["local", "google", "caldav", "imported", "task"])
export const calendarSyncPreferenceSchema = z.enum(["active", "pending", "ignored"])
export const integrationProviderSchema = z.enum(["google", "notion", "canvas", "caldav"])
export const userIntegrationStatusSchema = z.enum(["connected", "needs_reauth", "disconnected", "error"])
export const sourceConnectorIdSchema = z.enum(["google_calendar", "notion", "gmail", "canvas", "caldav", "apple_reminders"])
export const sourceConnectorStatusSchema = z.enum(["ready", "connected", "auth_needed", "missing_config", "failed"])
export const memoryLayerSchema = z.enum([
  "operating_rules",
  "planning_profile",
  "durable_preferences",
  "task_context",
  "deadline_context",
  "calendar_context",
  "source_status",
  "feedback_observations",
  "candidate_memories",
])
export const memoryKindSchema = z.enum([
  "preference",
  "task_context",
  "source_observation",
  "candidate",
  "observation",
  "rule",
])
export const memoryImportanceSchema = z.enum(["low", "medium", "high", "critical"])
export const memoryStatusSchema = z.enum(["active", "candidate", "stale", "superseded", "archived"])
// Must stay in sync with SourceKind in types/index.ts ("imessage"/"raycast" = hidden operator intakes).
export const sourceKindSchema = z.enum(["notion", "gmail", "caldav", "google_calendar", "manual", "system", "canvas", "apple_reminders", "imessage", "raycast"])
export const sourceFreshnessSchema = z.enum(["fresh", "partial", "stale", "failed"])
export const sourceFileStatusSchema = z.enum(["uploading", "ready", "processing", "processed", "failed"])
export const sourceCandidateKindSchema = z.enum(["task", "deadline", "event", "routine", "preference", "note"])
export const sourceCandidateStatusSchema = z.enum(["pending", "approved", "dismissed"])
export const dailyPlanStatusSchema = z.enum(["draft", "ready", "error", "superseded"])

const hhmmPattern = /^([01]\d|2[0-3]):([0-5]\d)$/
const tagSchema = z.string().trim().min(1)

export const userPreferencesSchema = z.object({
  userId: z.string().uuid(),
  timezone: z.string().min(1),
  sleepPattern: z.string().min(1).nullable(),
  peakEnergyWindow: z.string().min(1).nullable(),
  procrastinationPattern: z.string().min(1).nullable(),
  workdayStart: z.string().regex(hhmmPattern, "Expected HH:MM time"),
  workdayEnd: z.string().regex(hhmmPattern, "Expected HH:MM time"),
  defaultTaskDurationMinutes: z.number().int().positive(),
  breakDurationMinutes: z.number().int().nonnegative(),
  preferredFocusBlockMinutes: z.number().int().positive().nullable(),
  preferredCheckInMode: preferredCheckInModeSchema,
  calendarId: z.string().min(1).nullable(),
  plannerHorizonDays: z.number().int().min(7).max(56),
  morningDigestEnabled: z.boolean(),
  eveningDigestEnabled: z.boolean(),
  morningDigestTime: z.string().regex(hhmmPattern, "Expected HH:MM time"),
  eveningDigestTime: z.string().regex(hhmmPattern, "Expected HH:MM time"),
  quietHoursStart: z.string().regex(hhmmPattern, "Expected HH:MM time").nullable(),
  quietHoursEnd: z.string().regex(hhmmPattern, "Expected HH:MM time").nullable(),
})

export const taskSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().min(1).nullable(),
  deadline: z.string().datetime({ offset: true }).nullable(),
  durationMinutes: z.number().int().positive().nullable(),
  priority: prioritySchema,
  status: taskStatusSchema,
  scheduledFor: z.string().datetime({ offset: true }).nullable(),
  isImmutable: z.boolean(),
  allDay: z.boolean(),
  calendarId: z.string().min(1).nullable(),
  tags: z.array(tagSchema),
  course: z.string().min(1).nullable(),
  category: z.string().min(1).nullable(),
  sourceSnapshotId: z.string().uuid().nullable(),
  sourceCandidateId: z.string().uuid().nullable(),
  planId: z.string().uuid().nullable(),
  externalTaskId: z.string().min(1).nullable(),
  lastSyncedFrom: z.enum(["local", "caldav", "apple_reminders", "notion", "gmail", "canvas"]),
  inferredDeadline: z.string().datetime({ offset: true }).nullable(),
  inferredDeadlineReason: z.string().min(1).nullable(),
  inferredDeadlineDismissed: z.boolean(),
})

export const userCalendarSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  calendarKey: z.string().min(1),
  name: z.string().min(1),
  color: z.string().min(4),
  source: calendarSourceSchema,
  googleCalendarId: z.string().min(1).nullable(),
  remoteName: z.string().min(1).nullable(),
  isVisible: z.boolean(),
  isImmutable: z.boolean(),
  syncPreference: calendarSyncPreferenceSchema,
  isTaskCalendar: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
})

export const userIntegrationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  provider: integrationProviderSchema,
  providerAccountEmail: z.string().min(1).nullable(),
  providerUserId: z.string().min(1).nullable(),
  status: userIntegrationStatusSchema,
  selectedCalendarId: z.string().min(1).nullable(),
  selectedSourceId: z.string().min(1).nullable(),
  selectedSourceName: z.string().min(1).nullable(),
  lastSyncedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
})

export const sourceConnectorSchema = z.object({
  id: sourceConnectorIdSchema,
  status: sourceConnectorStatusSchema,
  detail: z.string().min(1),
  account: z.string().min(1).nullable(),
  canRun: z.boolean(),
  enabled: z.boolean(),
  selectedSourceId: z.string().min(1).nullable(),
  selectedSourceName: z.string().min(1).nullable(),
})

export const scheduleEventSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  title: z.string().min(1),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  source: scheduleEventSourceSchema,
  priority: prioritySchema,
  status: scheduleEventStatusSchema.nullable(),
  location: z.string().min(1).nullable(),
  externalEventId: z.string().min(1).nullable(),
  gcalEventId: z.string().min(1).nullable(),
  lastSyncedFrom: syncOriginSchema,
  isImmutable: z.boolean(),
  isCheckedIn: z.boolean(),
  allDay: z.boolean(),
  calendarId: z.string().min(1).nullable(),
  planId: z.string().uuid().nullable(),
})

export const scheduleEventInputSchema = scheduleEventSchema.omit({ userId: true }).extend({
  userId: z.string().uuid().optional(),
  priority: prioritySchema.optional().default("medium"),
  gcalEventId: z.string().min(1).nullable().optional().default(null),
  lastSyncedFrom: syncOriginSchema.optional().default("local"),
  allDay: z.boolean().optional().default(false),
  isCheckedIn: z.boolean().optional().default(false),
  planId: z.string().uuid().nullable().optional().default(null),
})

export const memoryEntrySummarySchema = z.object({
  id: z.string().uuid(),
  kind: memoryKindSchema,
  layer: memoryLayerSchema,
  category: z.string().min(1),
  insight: z.string().min(1),
  importance: memoryImportanceSchema,
  importanceNote: z.string().min(1).nullable(),
  source: z.string().min(1),
  confidence: z.number().nullable(),
  payload: z.record(z.unknown()),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
})

// Lifecycle-aware superset used only by the memory workbench API. Keep the summary
// schema above untouched — it is the frozen dashboard/assistant/schedule contract.
export const memoryItemDetailSchema = memoryEntrySummarySchema.extend({
  status: memoryStatusSchema,
  supersedesId: z.string().uuid().nullable(),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
  updatedAt: z.string().datetime({ offset: true }),
})

export const sourceSnapshotSummarySchema = z.object({
  id: z.string().uuid(),
  source: sourceKindSchema,
  freshness: sourceFreshnessSchema,
  summary: z.string().min(1),
  capturedAt: z.string().datetime({ offset: true }),
})

export const sourceFileSummarySchema = z.object({
  id: z.string().uuid(),
  source: sourceKindSchema,
  sourceRef: z.string().min(1).nullable(),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  storagePath: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  status: sourceFileStatusSchema,
  errorMessage: z.string().min(1).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
})

export const sourceCandidateSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  sourceSnapshotId: z.string().uuid().nullable(),
  sourceFileId: z.string().uuid().nullable(),
  kind: sourceCandidateKindSchema,
  title: z.string().min(1),
  description: z.string().min(1).nullable(),
  course: z.string().min(1).nullable(),
  dueAt: z.string().datetime({ offset: true }).nullable(),
  durationMinutes: z.number().int().positive().nullable(),
  priority: prioritySchema,
  confidence: z.number().min(0).max(1).nullable(),
  evidence: z.string().min(1).nullable(),
  payload: z.record(z.unknown()),
  status: sourceCandidateStatusSchema,
  approvedTaskId: z.string().uuid().nullable(),
  approvedEventId: z.string().uuid().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
})

export const dailyPlanNowItemSchema = z.object({
  title: z.string().min(1),
  why: z.string().min(1),
  start: z.string().datetime({ offset: true }).nullable(),
  end: z.string().datetime({ offset: true }).nullable(),
  taskId: z.string().uuid().nullable(),
  eventId: z.string().uuid().nullable(),
})

export const dailyPlanListItemSchema = z.object({
  title: z.string().min(1),
  start: z.string().datetime({ offset: true }).nullable(),
  end: z.string().datetime({ offset: true }).nullable(),
  kind: z.enum(["task", "event", "routine", "break"]),
})

export const dailyPlanRiskItemSchema = z.object({
  title: z.string().min(1),
  detail: z.string().min(1),
  severity: z.enum(["low", "medium", "high"]),
  riskType: riskTypeSchema,
  subjectKey: z.string().min(1),
  taskId: z.string().uuid().nullable().optional(),
  eventId: z.string().uuid().nullable().optional(),
})

export const riskDecisionSchema = z.object({
  id: z.string().uuid(),
  riskType: riskTypeSchema,
  subjectKey: z.string().min(1),
  taskId: z.string().uuid().nullable(),
  dismissedUntil: z.string().datetime({ offset: true }).nullable(),
  archivedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
})

export const sourceCoverageItemSchema = z.object({
  label: z.string().min(1),
  status: z.union([sourceFreshnessSchema, z.enum(["connected", "missing"])]),
  detail: z.string().min(1),
})

export const dailyPlanSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  horizonStart: z.string().datetime({ offset: true }),
  horizonEnd: z.string().datetime({ offset: true }),
  status: dailyPlanStatusSchema,
  summary: z.string().min(1),
  nowItem: dailyPlanNowItemSchema.nullable(),
  nextItems: z.array(dailyPlanListItemSchema),
  riskItems: z.array(dailyPlanRiskItemSchema),
  tradeoffs: z.array(z.string().min(1)),
  sourceCoverage: z.array(sourceCoverageItemSchema),
  command: z.string().min(1).nullable(),
  model: z.string().min(1).nullable(),
  errorMessage: z.string().min(1).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
})
