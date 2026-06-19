export const CLAUDE_PLANNER_MODEL_OPTIONS = [
  {
    key: "sonnet",
    label: "Sonnet",
    model: "claude-sonnet-4-6",
    description: "Balanced planner: fast, strong, and the default for daily scheduling.",
  },
  {
    key: "opus",
    label: "Opus",
    model: "claude-opus-4-8",
    description: "Deeper planner for complex days with more tradeoffs.",
  },
] as const

export type ClaudePlannerModelKey = (typeof CLAUDE_PLANNER_MODEL_OPTIONS)[number]["key"]

export const DEFAULT_CLAUDE_PLANNER_MODEL_KEY: ClaudePlannerModelKey = "sonnet"

export function isClaudePlannerModelKey(value: unknown): value is ClaudePlannerModelKey {
  return CLAUDE_PLANNER_MODEL_OPTIONS.some((option) => option.key === value)
}

export function getClaudePlannerModelOption(key: ClaudePlannerModelKey) {
  return CLAUDE_PLANNER_MODEL_OPTIONS.find((option) => option.key === key) ?? CLAUDE_PLANNER_MODEL_OPTIONS[0]
}
