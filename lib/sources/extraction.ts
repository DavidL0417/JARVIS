import { z } from "zod"

import { createOpenAIResponse, getOpenAIConfig, getOpenAIResponseText } from "@/lib/ai/openai"
import type { Priority, SourceCandidateKind, SourceKind } from "@/types"

const MAX_TEXT_SOURCE_CHARS = 60_000
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
}

export type SourceExtractionResult = {
  summary: string
  candidates: ExtractedSourceCandidate[]
  model: string
}

type InputContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_file"; filename: string; file_data: string }
  | { type: "input_image"; image_url: string }

const SOURCE_EXTRACTION_PROMPT = [
  "You extract scheduling context for JARVIS, a student secretary scheduler.",
  "Read the provided source and identify only explicit or strongly evidenced scheduling material.",
  "The product moment is not generic summarization: find deadlines, assignments, meetings, routines, preferences, and uncertainty that would help build a trustworthy week plan.",
  "Do not invent dates, courses, durations, or tasks. If a due date is ambiguous, keep dueAt null and explain the ambiguity in evidence.",
  "Use ISO 8601 timestamps with timezone offsets for dueAt when the source gives enough information. Assume America/Chicago only when the source gives a date without a timezone.",
  "Use priority high only for imminent, graded, blocking, or explicitly important items.",
  "Return compact candidates that a user can approve into the scheduler.",
].join("\n")

function candidateJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: {
        type: "string",
        description: "A short factual summary of what was extracted or why nothing actionable was found.",
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
  return {
    kind: candidate.kind,
    title: candidate.title.trim(),
    description: candidate.description?.trim() || null,
    course: candidate.course?.trim() || null,
    dueAt: normalizeDueAt(candidate.dueAt),
    durationMinutes: candidate.durationMinutes,
    priority: candidate.priority ?? "medium",
    confidence: candidate.confidence,
    evidence: candidate.evidence?.trim() || null,
  }
}

function sourceLabel(source: SourceKind) {
  if (source === "google_calendar") {
    return "Google Calendar"
  }

  return source[0]?.toUpperCase() + source.slice(1)
}

function buildExtractionTextPrompt(input: {
  source: SourceKind
  sourceRef?: string | null
  label?: string | null
  text?: string
}) {
  return [
    `Source: ${sourceLabel(input.source)}`,
    input.sourceRef ? `Source ref: ${input.sourceRef}` : null,
    input.label ? `Label: ${input.label}` : null,
    "",
    "Extract scheduler candidates from this source.",
    input.text ? `\nSOURCE TEXT:\n${input.text.slice(0, MAX_TEXT_SOURCE_CHARS)}` : null,
  ]
    .filter((part): part is string => typeof part === "string")
    .join("\n")
}

async function requestExtraction(content: InputContentPart[]) {
  const { model } = getOpenAIConfig()
  const payload = await createOpenAIResponse({
    model,
    instructions: SOURCE_EXTRACTION_PROMPT,
    input: [
      {
        role: "user",
        content,
      },
    ],
    max_output_tokens: 2400,
    temperature: 0,
    text: {
      format: {
        type: "json_schema",
        name: "source_extraction",
        strict: true,
        schema: candidateJsonSchema(),
      },
    },
  })
  const text = getOpenAIResponseText(payload)

  if (!text) {
    throw new Error("OpenAI returned no source extraction payload.")
  }

  const parsed = extractionResultSchema.parse(JSON.parse(text))

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
}): Promise<SourceExtractionResult> {
  const prompt = buildExtractionTextPrompt(input)
  return requestExtraction([{ type: "input_text", text: prompt }])
}

export async function extractCandidatesFromFile(input: {
  source: SourceKind
  sourceRef?: string | null
  fileName: string
  mimeType: string
  buffer: Buffer
}): Promise<SourceExtractionResult> {
  const prompt = buildExtractionTextPrompt({
    source: input.source,
    sourceRef: input.sourceRef,
    label: input.fileName,
    text: SUPPORTED_TEXT_MIME_TYPES.has(input.mimeType)
      ? input.buffer.toString("utf8")
      : undefined,
  })

  if (SUPPORTED_TEXT_MIME_TYPES.has(input.mimeType)) {
    return requestExtraction([{ type: "input_text", text: prompt }])
  }

  const base64 = input.buffer.toString("base64")

  if (input.mimeType === "application/pdf") {
    return requestExtraction([
      { type: "input_text", text: prompt },
      {
        type: "input_file",
        filename: input.fileName,
        file_data: `data:application/pdf;base64,${base64}`,
      },
    ])
  }

  if (input.mimeType.startsWith("image/")) {
    return requestExtraction([
      { type: "input_text", text: prompt },
      {
        type: "input_image",
        image_url: `data:${input.mimeType};base64,${base64}`,
      },
    ])
  }

  throw new Error(`Unsupported source file type for extraction: ${input.mimeType}. Upload a PDF, image, or plain text file.`)
}
