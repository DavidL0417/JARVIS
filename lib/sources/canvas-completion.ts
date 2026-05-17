import {
  CanvasApiError,
  createCanvasPlannerOverride,
  updateCanvasPlannerOverride,
} from "@/lib/canvas"
import { SOURCE_CANDIDATE_SELECT } from "@/lib/data/mappers"
import {
  getStoredCanvasIntegration,
  markCanvasIntegrationStatus,
} from "@/lib/supabase/canvas-integration"
import type { requireAuthenticatedUser } from "@/lib/supabase/auth"
import type { SourceCandidateRow, TaskRow } from "@/types"

type AdminClient = Awaited<ReturnType<typeof requireAuthenticatedUser>>["adminClient"]

export interface CanvasExternalWriteResult {
  source: "canvas"
  status: "completed" | "failed" | "skipped"
  summary: string
  error?: string | null
}

function canvasMetadata(payload: Record<string, unknown> | null | undefined) {
  const canvas = payload?.canvas
  return canvas && typeof canvas === "object" ? canvas as Record<string, unknown> : null
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export async function markCanvasTaskComplete(input: {
  adminClient: AdminClient
  userId: string
  task: TaskRow
}): Promise<CanvasExternalWriteResult | null> {
  if (!input.task.source_candidate_id) {
    return null
  }

  const { data: candidate, error: candidateError } = await input.adminClient
    .from("source_candidates")
    .select(SOURCE_CANDIDATE_SELECT)
    .eq("id", input.task.source_candidate_id)
    .eq("user_id", input.userId)
    .maybeSingle<SourceCandidateRow>()

  if (candidateError) {
    throw new Error(candidateError.message)
  }

  const canvas = canvasMetadata(candidate?.payload)

  if (!candidate || !canvas) {
    return null
  }

  const plannableType = stringField(canvas, "plannableType")
  const plannableId = stringField(canvas, "plannableId")

  if (!plannableType || !plannableId) {
    return {
      source: "canvas",
      status: "skipped",
      summary: "Canvas completion skipped because this task is missing Canvas planner metadata.",
    }
  }

  try {
    const integration = await getStoredCanvasIntegration(input.userId)

    if (!integration?.base_url || !integration.access_token || integration.status !== "connected") {
      throw new Error("Reconnect Canvas before syncing task completion.")
    }

    const overrideId = stringField(canvas, "plannerOverrideId")
    const override = overrideId
      ? await updateCanvasPlannerOverride({
          baseUrl: integration.base_url,
          accessToken: integration.access_token,
          overrideId,
          markedComplete: true,
        })
      : await createCanvasPlannerOverride({
          baseUrl: integration.base_url,
          accessToken: integration.access_token,
          plannableType,
          plannableId,
          markedComplete: true,
        })

    const nextPayload = {
      ...candidate.payload,
      canvas: {
        ...canvas,
        plannerOverrideId: override.id ? String(override.id) : overrideId,
        markedComplete: true,
      },
    }

    await input.adminClient
      .from("source_candidates")
      .update({
        payload: nextPayload,
        updated_at: new Date().toISOString(),
      })
      .eq("id", candidate.id)
      .eq("user_id", input.userId)

    await input.adminClient.from("assistant_tool_runs").insert({
      user_id: input.userId,
      thread_id: null,
      message_id: null,
      tool_name: "canvas_planner_override",
      status: "completed",
      summary: `Marked Canvas planner item complete for ${input.task.title}.`,
      payload: {
        action: "canvas_planner_mark_complete",
        taskId: input.task.id,
        sourceCandidateId: candidate.id,
        plannableType,
        plannableId,
      },
      requires_approval: false,
      executed_at: new Date().toISOString(),
    })

    await input.adminClient.from("change_logs").insert({
      user_id: input.userId,
      actor: "assistant",
      action: "external.canvas_planner.complete",
      target_table: "tasks",
      target_id: input.task.id,
      summary: `Synced completion to Canvas for ${input.task.title}.`,
      before_value: null,
      after_value: {
        plannableType,
        plannableId,
        overrideId: override.id ?? overrideId,
      },
      source_label: "canvas",
    })

    return {
      source: "canvas",
      status: "completed",
      summary: "Canvas planner item marked complete.",
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Canvas completion sync failed."

    if (error instanceof CanvasApiError && error.reauthorizationRequired) {
      await markCanvasIntegrationStatus({
        userId: input.userId,
        status: "needs_reauth",
      })
    }

    await input.adminClient.from("assistant_tool_runs").insert({
      user_id: input.userId,
      thread_id: null,
      message_id: null,
      tool_name: "canvas_planner_override",
      status: "error",
      summary: "Canvas planner completion sync failed.",
      payload: {
        action: "canvas_planner_mark_complete",
        taskId: input.task.id,
        sourceCandidateId: candidate.id,
        plannableType,
        plannableId,
      },
      requires_approval: false,
      executed_at: new Date().toISOString(),
      error_message: message,
    })

    await input.adminClient.from("change_logs").insert({
      user_id: input.userId,
      actor: "assistant",
      action: "external.canvas_planner.complete_failed",
      target_table: "tasks",
      target_id: input.task.id,
      summary: `Canvas completion sync failed for ${input.task.title}: ${message}`,
      before_value: null,
      after_value: {
        plannableType,
        plannableId,
        error: message,
      },
      source_label: "canvas",
    })

    return {
      source: "canvas",
      status: "failed",
      summary: "Canvas planner completion sync failed.",
      error: message,
    }
  }
}
