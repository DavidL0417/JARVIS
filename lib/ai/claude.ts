// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import Anthropic from "@anthropic-ai/sdk"

import type { ReplanRequest } from "@/schemas/replan"
import type { SchedulePlanResult, SchedulePreparationContext } from "@/types"

export function getClaudeClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    return null
  }

  return new Anthropic({ apiKey })
}

export async function generateSchedule(input: SchedulePreparationContext): Promise<SchedulePlanResult> {
  const client = getClaudeClient()

  void client

  // TODO: Intentionally stubbed for the backend foundation milestone until David wires the planner prompt/output.
  return {
    plannerStatus: "stubbed",
    proposedEvents: [],
    unscheduledTaskIds: input.tasks.map((task) => task.id),
    summary: "Schedule generation is stubbed until AI orchestration is connected.",
  }
}

export async function replanSchedule(input: ReplanRequest) {
  const client = getClaudeClient()

  void client

  // TODO: Intentionally stubbed until replanning logic is implemented against the persisted schedule model.
  return {
    success: true,
    reason: input.reason,
    message: "Replan generation is stubbed until AI orchestration is connected.",
  }
}

// ##### END BACKEND #####
