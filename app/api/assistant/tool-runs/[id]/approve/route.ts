import { NextResponse } from "next/server"

import { ASSISTANT_TOOL_RUN_SELECT } from "@/lib/data/mappers"
import { syncTaskEventsToGoogleForUser } from "@/lib/google-calendar-events"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import type { AssistantToolRunRow } from "@/types"

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

function payloadAction(payload: Record<string, unknown>) {
  return typeof payload.action === "string" ? payload.action : null
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const { adminClient, user } = await requireAuthenticatedUser()
    const { data: toolRun, error } = await adminClient
      .from("assistant_tool_runs")
      .select(ASSISTANT_TOOL_RUN_SELECT)
      .eq("id", id)
      .eq("user_id", user.id)
      .single<AssistantToolRunRow>()

    if (error || !toolRun) {
      return NextResponse.json({ error: error?.message || "Approval request not found." }, { status: 404 })
    }

    if (toolRun.status !== "pending_approval" || !toolRun.requires_approval) {
      return NextResponse.json({ error: "This tool run is not awaiting approval." }, { status: 409 })
    }

    if (payloadAction(toolRun.payload) !== "google_task_event_sync") {
      return NextResponse.json({ error: "Unsupported external action." }, { status: 400 })
    }

    const approvedAt = new Date().toISOString()

    const { error: approvedError } = await adminClient
      .from("assistant_tool_runs")
      .update({
        approved_at: approvedAt,
      })
      .eq("id", toolRun.id)
      .eq("user_id", user.id)

    if (approvedError) {
      throw new Error(approvedError.message)
    }

    try {
      const result = await syncTaskEventsToGoogleForUser(user.id)

      if (!result.connected || result.error) {
        throw new Error(result.error || "Google Calendar is not connected.")
      }

      const executedAt = new Date().toISOString()
      const summary = `Approved and synced ${result.synced} JARVIS task block${result.synced === 1 ? "" : "s"} to Google Calendar.`

      const { error: updateError } = await adminClient
        .from("assistant_tool_runs")
        .update({
          status: "completed",
          summary,
          requires_approval: false,
          executed_at: executedAt,
          error_message: null,
        })
        .eq("id", toolRun.id)
        .eq("user_id", user.id)

      if (updateError) {
        throw new Error(updateError.message)
      }

      await adminClient.from("change_logs").insert({
        user_id: user.id,
        actor: "assistant",
        action: "external.google_task_sync.approve",
        target_table: "assistant_tool_runs",
        target_id: toolRun.id,
        summary,
        before_value: {
          status: toolRun.status,
          requiresApproval: toolRun.requires_approval,
        },
        after_value: {
          status: "completed",
          synced: result.synced,
        },
        source_label: "master_input_approval",
      })

      return NextResponse.json({
        ok: true,
        toolCall: {
          id: toolRun.id,
          tool: toolRun.tool_name,
          status: "completed",
          summary,
          requiresApproval: false,
          errorMessage: null,
        },
        result,
      })
    } catch (executionError) {
      const message = executionError instanceof Error ? executionError.message : "Approval execution failed."
      await adminClient
        .from("assistant_tool_runs")
        .update({
          status: "error",
          requires_approval: false,
          executed_at: new Date().toISOString(),
          error_message: message,
        })
        .eq("id", toolRun.id)
        .eq("user_id", user.id)

      return NextResponse.json(
        {
          ok: false,
          error: message,
          toolCall: {
            id: toolRun.id,
            tool: toolRun.tool_name,
            status: "error",
            summary: "Approval execution failed.",
            requiresApproval: false,
            errorMessage: message,
          },
        },
        { status: 500 },
      )
    }
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to approve assistant tool run.",
      },
      { status: 500 },
    )
  }
}
