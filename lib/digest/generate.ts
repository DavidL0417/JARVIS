import Anthropic from "@anthropic-ai/sdk"

import { getClaudePlannerModelOption } from "@/lib/ai/claude-models"

// Terse one-shot Claude call that authors a digest's text. Deliberately a single
// completion (not the multi-iteration agent loop) — a digest is one short message.
// Powered by Opus 4.8 for tone; NOTE: Opus 4.8 returns 400 if `temperature` is
// sent, so it is intentionally omitted (see reference-opus-48-temperature-deprecated).

const DEFAULT_DIGEST_MODEL = getClaudePlannerModelOption("opus").model // claude-opus-4-8

function digestModel(): string {
  // Shares the agent model override; never inherits ANTHROPIC_DIALOGUE_MODEL (Sonnet).
  return process.env.ANTHROPIC_AGENT_MODEL || DEFAULT_DIGEST_MODEL
}

function messageText(message: Anthropic.Messages.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim()
}

export async function generateDigestText(input: {
  system: string
  payload: unknown
  maxTokens?: number
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is missing; cannot generate the digest text.")
  }

  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model: digestModel(),
    system: input.system,
    messages: [
      {
        role: "user",
        content: typeof input.payload === "string" ? input.payload : JSON.stringify(input.payload, null, 2),
      },
    ],
    max_tokens: input.maxTokens ?? 500,
    // No `temperature`: Opus 4.8 rejects it.
  })

  const text = messageText(response)
  if (!text) {
    throw new Error("The digest model returned an empty response.")
  }
  return text
}
