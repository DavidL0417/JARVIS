import { NextResponse } from "next/server"

import { ASSISTANT_TOOL_RUN_SELECT } from "@/lib/data/mappers"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import type { AssistantToolRunRow } from "@/types"

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
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

    if (toolRun.status !== "pending_approval") {
      return NextResponse.json({ error: "This tool run is not awaiting approval." }, { status: 409 })
    }

    const cancelledAt = new Date().toISOString()
    const summary = "Cancelled external write approval."
    const { error: updateError } = await adminClient
      .from("assistant_tool_runs")
      .update({
        status: "cancelled",
        summary,
        requires_approval: false,
        cancelled_at: cancelledAt,
      })
      .eq("id", toolRun.id)
      .eq("user_id", user.id)

    if (updateError) {
      throw new Error(updateError.message)
    }

    await adminClient.from("change_logs").insert({
      user_id: user.id,
      actor: "assistant",
      action: "external.approval.cancel",
      target_table: "assistant_tool_runs",
      target_id: toolRun.id,
      summary,
      before_value: {
        status: toolRun.status,
        requiresApproval: toolRun.requires_approval,
      },
      after_value: {
        status: "cancelled",
      },
      source_label: "master_input_approval",
    })

    return NextResponse.json({
      ok: true,
      toolCall: {
        id: toolRun.id,
        tool: toolRun.tool_name,
        status: "cancelled",
        summary,
        requiresApproval: false,
        errorMessage: null,
      },
    })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to cancel assistant tool run.",
      },
      { status: 500 },
    )
  }
}
