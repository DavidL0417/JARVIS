import { z } from "zod"

import { createOpenAIResponse, getOpenAIConfig, getOpenAIResponseText } from "@/lib/ai/openai"
import type { ExtractedSourceCandidate } from "@/lib/sources/extraction"
import type { CanvasExtensionExtractionResult, CanvasExtensionPageSnapshot } from "@/schemas/canvas-extension"

const CANVAS_EXTENSION_MODEL = process.env.OPENAI_CANVAS_EXTENSION_MODEL || process.env.OPENAI_CLASSIFIER_MODEL

const rawCandidateSchema = z.object({
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

const rawExtractionSchema = z.object({
  summary: z.string().trim().min(1),
  pageKind: z.string().trim().min(1).nullable(),
  confidence: z.number().min(0).max(1),
  skippedReason: z.string().trim().min(1).nullable(),
  candidates: z.array(rawCandidateSchema),
})

const CANVAS_PAGE_READER_PROMPT = [
  "You are the extraction engine for JARVIS Canvas Academic Reader.",
  "Read sanitized Canvas page text and extract only scheduling-relevant academic context.",
  "This is a read-only ingestion workflow. Never infer that JARVIS can submit, comment, upload, message, enroll, mark complete, start quizzes, or change Canvas state.",
  "Extract assignments, deadlines, course requirements, module tasks, syllabus rules, comments/feedback that affect planning, and useful notes.",
  "Do not invent dates. Use null dueAt when a due date is ambiguous. Use ISO 8601 timestamps with timezone offsets when explicit enough.",
  "Return low confidence for noisy pages. Return a skippedReason when the page appears unsafe, active timed quiz/test content, or irrelevant.",
].join("\n")

function extractionJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      pageKind: { type: ["string", "null"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      skippedReason: { type: ["string", "null"] },
      candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["task", "deadline", "event", "routine", "preference", "note"] },
            title: { type: "string" },
            description: { type: ["string", "null"] },
            course: { type: ["string", "null"] },
            dueAt: { type: ["string", "null"] },
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
    required: ["summary", "pageKind", "confidence", "skippedReason", "candidates"],
  }
}

function normalizeDueAt(value: string | null) {
  if (!value) {
    return null
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function normalizeCandidate(candidate: z.infer<typeof rawCandidateSchema>, pageUrl: string): ExtractedSourceCandidate {
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
    evidence: candidate.evidence?.trim() || pageUrl,
    allDay: isDateOnly || isMultiDay,
  }
}

function buildPrompt(snapshot: CanvasExtensionPageSnapshot) {
  return [
    `Canvas origin: ${snapshot.canvasOrigin}`,
    `Page URL: ${snapshot.url}`,
    `Page title: ${snapshot.title}`,
    `Course hint: ${snapshot.courseHint ?? "unknown"}`,
    `Page kind hint: ${snapshot.pageKindHint ?? "unknown"}`,
    `Captured at: ${snapshot.capturedAt}`,
    "",
    "Visible links:",
    ...snapshot.links.slice(0, 40).map((link) => `- ${link.text ?? "Untitled"}: ${link.url}`),
    "",
    "Visible Canvas page text:",
    snapshot.visibleText,
  ].join("\n")
}

export async function extractCanvasExtensionPage(input: CanvasExtensionPageSnapshot): Promise<CanvasExtensionExtractionResult & {
  model: string
  extractedCandidates: ExtractedSourceCandidate[]
}> {
  const baseConfig = getOpenAIConfig()
  const model = CANVAS_EXTENSION_MODEL || baseConfig.model
  const payload = await createOpenAIResponse({
    model,
    instructions: CANVAS_PAGE_READER_PROMPT,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: buildPrompt(input) }],
      },
    ],
    max_output_tokens: 2200,
    temperature: 0,
    text: {
      format: {
        type: "json_schema",
        name: "canvas_extension_page_extraction",
        strict: true,
        schema: extractionJsonSchema(),
      },
    },
  })
  const text = getOpenAIResponseText(payload)

  if (!text) {
    throw new Error("OpenAI returned no Canvas extension extraction payload.")
  }

  const parsed = rawExtractionSchema.parse(JSON.parse(text))
  const extractedCandidates = parsed.skippedReason
    ? []
    : parsed.candidates.map((candidate) => normalizeCandidate(candidate, input.url))

  return {
    summary: parsed.summary,
    pageKind: parsed.pageKind,
    confidence: parsed.confidence,
    skippedReason: parsed.skippedReason,
    candidates: extractedCandidates.map((candidate) => ({
      kind: candidate.kind,
      title: candidate.title,
      description: candidate.description,
      course: candidate.course,
      dueAt: candidate.dueAt,
      durationMinutes: candidate.durationMinutes,
      priority: candidate.priority,
      confidence: candidate.confidence,
      evidence: candidate.evidence,
    })),
    model,
    extractedCandidates,
  }
}
