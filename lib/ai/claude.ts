// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import Anthropic from "@anthropic-ai/sdk"

import type { ReplanRequest } from "@/schemas/replan"
import type { ScheduleRequest } from "@/schemas/schedule"

export function getClaudeClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    return null
  }

  return new Anthropic({ apiKey })
}

export async function generateSchedule(input: ScheduleRequest) {
  const client = getClaudeClient()

  void client

  // TODO: Replace this stub with a real Claude prompt + structured parsing flow.
  return {
    success: true,
    scheduledTaskCount: input.tasks.length,
    message: "Schedule generation is stubbed until AI orchestration is connected.",
  }
}

export async function replanSchedule(input: ReplanRequest) {
  const client = getClaudeClient()

  void client

  // TODO: Replace this stub with a replan prompt that preserves pinned calendar blocks.
  return {
    success: true,
    reason: input.reason,
    message: "Replan generation is stubbed until AI orchestration is connected.",
  }
}

// ##### END BACKEND #####
