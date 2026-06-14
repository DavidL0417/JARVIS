import Anthropic from "@anthropic-ai/sdk"

const DEFAULT_EXTRACTION_MODEL = "claude-sonnet-4-6"

// Source extraction (Gmail / Notion / Canvas / iMessage) runs on Claude via a
// single forced tool call — the same structured-output pattern the scheduler uses
// in lib/ai/claude.ts (which is backend-owned / do-not-modify). Kept as its own
// client so extraction has an independent model knob and error message.
export function getClaudeExtractionConfig() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is missing. Configure Claude before running source extraction.")
  }
  return {
    apiKey,
    model: process.env.ANTHROPIC_MODEL || DEFAULT_EXTRACTION_MODEL,
  }
}

export interface ClaudeStructuredExtractionResult {
  data: unknown
  model: string
}

// Sends one user turn (text and/or document/image blocks) and forces Claude to
// answer with exactly one call to `toolName`. The tool input is returned raw for
// the caller to zod-parse. Throws SOURCE_EXTRACTION_FAILED if no tool call comes
// back (so callers can distinguish it from auth/transport failures).
export async function runClaudeStructuredExtraction(input: {
  system: string
  content: Anthropic.MessageParam["content"]
  toolName: string
  toolDescription: string
  inputSchema: Record<string, unknown>
  maxTokens: number
}): Promise<ClaudeStructuredExtractionResult> {
  const { apiKey, model } = getClaudeExtractionConfig()
  const client = new Anthropic({ apiKey })

  const message = await client.messages.create({
    model,
    max_tokens: input.maxTokens,
    temperature: 0,
    system: input.system,
    messages: [{ role: "user", content: input.content }],
    tools: [
      {
        name: input.toolName,
        description: input.toolDescription,
        input_schema: input.inputSchema as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: input.toolName, disable_parallel_tool_use: true },
  })

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === input.toolName,
  )

  if (!toolUse) {
    throw new Error(
      `SOURCE_EXTRACTION_FAILED: Claude did not return the ${input.toolName} tool payload. Retry the scan or reduce the source payload.`,
    )
  }

  return { data: toolUse.input, model }
}
