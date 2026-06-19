import { z } from "zod"

import Anthropic from "@anthropic-ai/sdk"

import { runClaudeStructuredExtraction } from "@/lib/ai/claude-extraction"
import type { CommitmentRef } from "@/lib/dedupe"
import type { Priority, SourceCandidateKind, SourceKind, TaskSyncOrigin } from "@/types"

const MAX_TEXT_SOURCE_CHARS = 60_000
const SOURCE_EXTRACTION_OUTPUT_TOKENS = 8000
const SOURCE_EXTRACTION_TOOL_NAME = "return_source_extraction"
const SUPPORTED_TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
])

const extractedCandidateSchema = z.object({
  kind: z.enum(["task", "deadline", "event", "routine", "preference", "note"]),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1).nullable(),
  course: z.string().trim().min(1).nullable(),
  dueAt: z.string().trim().min(1).nullable(),
  durationMinutes: z.number().int().positive().nullable(),
  priority: z.enum(["low", "medium", "high"]).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  evidence: z.string().trim().min(1).nullable(),
})

const extractionResultSchema = z.object({
  summary: z.string().trim().min(1),
  candidates: z.array(extractedCandidateSchema),
})

export type ExtractedSourceCandidate = {
  kind: SourceCandidateKind
  title: string
  description: string | null
  course: string | null
  dueAt: string | null
  durationMinutes: number | null
  priority: Priority
  confidence: number | null
  evidence: string | null
  allDay: boolean
  // Provenance link back to the upstream record (e.g. a Notion page id) and the
  // origin label. Set by structured importers like Notion; left undefined by the
  // free-text LLM extractor. Threaded into the candidate payload, then onto the
  // task as external_task_id / last_synced_from so two-way sync can match rows.
  externalId?: string | null
  externalSource?: TaskSyncOrigin
}

export type SourceExtractionResult = {
  summary: string
  candidates: ExtractedSourceCandidate[]
  model: string
}

const SOURCE_EXTRACTION_PROMPT = [
  "You extract scheduling context for JARVIS, a student secretary scheduler.",
  "Read the provided source and identify only explicit or strongly evidenced scheduling material.",
  "The product moment is source intelligence, not generic summarization: find deadlines, assignments, meetings, routines, preferences, quick replies, admin/logistics decisions, resource links, instructor overrides, and uncertainty that would help build a trustworthy week plan.",
  "For Gmail, treat email as context first and a task source second. Prioritize direct To/CC messages, messages naming the user as responsible, replies/RSVPs/confirmations, deadline overrides, logistics, and small 2-10 minute actions. Treat newsletters, broadcasts, digests, and notification-only messages as low confidence unless they clearly change the user's plan.",
  "Do not invent dates, courses, durations, or tasks. If a due date is ambiguous, keep dueAt null and explain the ambiguity in evidence.",
  "Use ISO 8601 timestamps with timezone offsets for dueAt when the source gives enough information. Assume America/Chicago only when the source gives a date without a timezone.",
  "Use priority high only for imminent, graded, blocking, or explicitly important items.",
  "Return task/deadline/event candidates only when they need scheduler action. Return note candidates for useful context that should inform the secretary but should not become a task.",
  "Distinguish the three actionable kinds carefully, because they route differently: use 'event' ONLY for a fixed-time commitment that happens AT a specific time and is not work to complete — a class, lecture, recital, jury, meeting, exam sitting, appointment, office hours (these become calendar events). Use 'deadline' for something DUE BY a date with no fixed work time (an assignment due date). Use 'task' for work the user must do that needs a block found for it. When unsure between event and task, prefer task.",
  "When an EXISTING COMMITMENTS list is provided, do NOT emit candidates that duplicate any entry — including reworded, partial, or differently-scoped descriptions of the same real-world item (a sign-up email, a reminder email, and a calendar event about one recital are ONE commitment). Only emit a candidate for a listed item when the source changes it (new due date, time, or location) and say what changed in evidence.",
  "Return at most 12 candidates. Keep the summary under 900 characters and each evidence field under 180 characters.",
].join("\n")

const MAX_COMMITMENT_CONTEXT_ENTRIES = 80

function buildExistingCommitmentsSection(commitments: CommitmentRef[] | undefined) {
  if (!commitments || commitments.length === 0) {
    return null
  }

  const lines = commitments
    .slice(0, MAX_COMMITMENT_CONTEXT_ENTRIES)
    .map((commitment) => `- ${commitment.at ? `${commitment.at} — ` : ""}${commitment.title}`)

  return ["", "EXISTING COMMITMENTS (already tracked; do not duplicate):", ...lines].join("\n")
}

function candidateJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: {
        type: "string",
        description: "A short factual context digest of what changed, what mattered, and why nothing scheduler-actionable was found when applicable.",
      },
      candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: {
              type: "string",
              enum: ["task", "deadline", "event", "routine", "preference", "note"],
            },
            title: { type: "string" },
            description: { type: ["string", "null"] },
            course: { type: ["string", "null"] },
            dueAt: {
              type: ["string", "null"],
              description: "ISO 8601 timestamp with timezone offset, or null when the date/time is not explicit enough.",
            },
            durationMinutes: { type: ["integer", "null"] },
            priority: { type: ["string", "null"], enum: ["low", "medium", "high", null] },
            confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
            evidence: { type: ["string", "null"] },
          },
          required: [
            "kind",
            "title",
            "description",
            "course",
            "dueAt",
            "durationMinutes",
            "priority",
            "confidence",
            "evidence",
          ],
        },
      },
    },
    required: ["summary", "candidates"],
  }
}

function normalizeDueAt(value: string | null) {
  if (!value) {
    return null
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function normalizeCandidate(candidate: z.infer<typeof extractedCandidateSchema>): ExtractedSourceCandidate {
  const rawDue = candidate.dueAt
  const dueAt = normalizeDueAt(rawDue)
  const isDateOnly = Boolean(rawDue && /^\d{4}-\d{2}-\d{2}$/.test(rawDue.trim()))
  const isMultiDay = (candidate.durationMinutes ?? 0) >= 1440
  return {
    kind: candidate.kind,
    title: candidate.title.trim(),
    description: candidate.description?.trim() || null,
    course: candidate.course?.trim() || null,
    dueAt,
    durationMinutes: candidate.durationMinutes,
    priority: candidate.priority ?? "medium",
    confidence: candidate.confidence,
    evidence: candidate.evidence?.trim() || null,
    allDay: isDateOnly || isMultiDay,
  }
}

function sourceLabel(source: SourceKind) {
  if (source === "google_calendar") {
    return "Google Calendar"
  }

  if (source === "imessage") {
    return "iMessage"
  }

  return source[0]?.toUpperCase() + source.slice(1)
}

function buildExtractionTextPrompt(input: {
  source: SourceKind
  sourceRef?: string | null
  label?: string | null
  text?: string
  existingCommitments?: CommitmentRef[]
}) {
  return [
    `Source: ${sourceLabel(input.source)}`,
    input.sourceRef ? `Source ref: ${input.sourceRef}` : null,
    input.label ? `Label: ${input.label}` : null,
    "",
    "Extract scheduler candidates from this source.",
    buildExistingCommitmentsSection(input.existingCommitments),
    input.text ? `\nSOURCE TEXT:\n${input.text.slice(0, MAX_TEXT_SOURCE_CHARS)}` : null,
  ]
    .filter((part): part is string => typeof part === "string")
    .join("\n")
}

async function requestExtraction(content: Anthropic.MessageParam["content"]) {
  const { data, model } = await runClaudeStructuredExtraction({
    system: SOURCE_EXTRACTION_PROMPT,
    content,
    toolName: SOURCE_EXTRACTION_TOOL_NAME,
    toolDescription: "Return the source extraction summary and scheduler candidates.",
    inputSchema: candidateJsonSchema(),
    maxTokens: SOURCE_EXTRACTION_OUTPUT_TOKENS,
  })

  const parsed = extractionResultSchema.parse(data)

  return {
    summary: parsed.summary,
    candidates: parsed.candidates.map(normalizeCandidate),
    model,
  }
}

export async function extractCandidatesFromText(input: {
  source: SourceKind
  sourceRef?: string | null
  label?: string | null
  text: string
  existingCommitments?: CommitmentRef[]
}): Promise<SourceExtractionResult> {
  const prompt = buildExtractionTextPrompt(input)
  return requestExtraction([{ type: "text", text: prompt }])
}

export async function extractCandidatesFromFile(input: {
  source: SourceKind
  sourceRef?: string | null
  fileName: string
  mimeType: string
  buffer: Buffer
  existingCommitments?: CommitmentRef[]
}): Promise<SourceExtractionResult> {
  const prompt = buildExtractionTextPrompt({
    source: input.source,
    sourceRef: input.sourceRef,
    label: input.fileName,
    existingCommitments: input.existingCommitments,
    text: SUPPORTED_TEXT_MIME_TYPES.has(input.mimeType)
      ? input.buffer.toString("utf8")
      : undefined,
  })

  if (SUPPORTED_TEXT_MIME_TYPES.has(input.mimeType)) {
    return requestExtraction([{ type: "text", text: prompt }])
  }

  const base64 = input.buffer.toString("base64")

  if (input.mimeType === "application/pdf") {
    return requestExtraction([
      { type: "text", text: prompt },
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64 },
      },
    ])
  }

  if (input.mimeType.startsWith("image/")) {
    return requestExtraction([
      { type: "text", text: prompt },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: input.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: base64,
        },
      },
    ])
  }

  throw new Error(`Unsupported source file type for extraction: ${input.mimeType}. Upload a PDF, image, or plain text file.`)
}
