import Anthropic from "@anthropic-ai/sdk"

const HAIKU_MODEL = process.env.ANTHROPIC_HAIKU_MODEL || "claude-haiku-4-5-20251001"
const MAX_INPUT_CHARS = 4000

const NORMALIZER_SYSTEM_PROMPT = [
  "You normalize a user-provided memory into a tight, durable form for a personal-assistant memory store.",
  "Rewrite the user's raw text into one or two clear sentences capturing the rule, preference, or fact.",
  "Preserve specifics: durations (e.g. \"4 hours\"), recurrences (e.g. \"once per week\"), dates, named entities.",
  "Strip filler words (\"like\", \"gotta\", \"tday\", \"you know\"). Fix typos. Use proper sentence case.",
  "Do not invent new facts. Do not add interpretation beyond what the user said.",
  "Reply with JSON only: { \"content\": string }.",
].join("\n")

export async function normalizeMemoryContent(raw: string): Promise<string> {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return trimmed

  const truncated = trimmed.length > MAX_INPUT_CHARS ? trimmed.slice(0, MAX_INPUT_CHARS) : trimmed

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 300,
      temperature: 0,
      system: NORMALIZER_SYSTEM_PROMPT,
      messages: [{ role: "user", content: truncated }],
    })

    const textBlock = response.content.find((block) => block.type === "text")
    if (!textBlock || textBlock.type !== "text") return trimmed

    const text = textBlock.text.trim()
    if (!text) return trimmed

    const jsonStart = text.indexOf("{")
    const jsonEnd = text.lastIndexOf("}")
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
      return text
    }

    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as { content?: unknown }
    if (typeof parsed.content === "string" && parsed.content.trim()) {
      return parsed.content.trim()
    }

    return trimmed
  } catch {
    return trimmed
  }
}
