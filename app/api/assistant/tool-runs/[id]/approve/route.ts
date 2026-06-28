import { NextResponse } from "next/server"

import { ASSISTANT_TOOL_RUN_SELECT } from "@/lib/data/mappers"
import {
  createGoogleCalendarEventForUser,
  syncTaskEventsToGoogleForUser,
} from "@/lib/google-calendar-events"
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

    const action = payloadAction(toolRun.payload)
    if (action !== "google_task_event_sync" && action !== "google_calendar_event_create") {
      return NextResponse.json({ error: "Unsupported external action." }, { status: 400 })
    }

    const approvedAt = new Date().toISOString()

    // Atomic claim: flip requires_approval→false guarded on the still-pending state.
    // A double-click on Approve, a client retry, or a replayed POST otherwise both
    // pass the read check above and each execute the external write (duplicate
    // events). Only the request that actually flips the row proceeds; the loser 409s.
    const { data: claimed, error: approvedError } = await adminClient
      .from("assistant_tool_runs")
      .update({
        approved_at: approvedAt,
        requires_approval: false,
      })
      .eq("id", toolRun.id)
      .eq("user_id", user.id)
      .eq("status", "pending_approval")
      .eq("requires_approval", true)
      .select("id")

    if (approvedError) {
      throw new Error(approvedError.message)
    }

    if (!claimed || claimed.length === 0) {
      return NextResponse.json({ error: "This tool run is not awaiting approval." }, { status: 409 })
    }

    try {
      let summary: string
      let result: unknown
      let auditAfter: Record<string, unknown>

      if (action === "google_calendar_event_create") {
        const payload = toolRun.payload as Record<string, unknown>
        const created = await createGoogleCalendarEventForUser(user.id, {
          title: typeof payload.title === "string" ? payload.title : "",
          startIso: typeof payload.startIso === "string" ? payload.startIso : "",
          endIso: typeof payload.endIso === "string" ? payload.endIso : "",
          calendarName: typeof payload.calendarName === "string" ? payload.calendarName : null,
          description: typeof payload.description === "string" ? payload.description : null,
          location: typeof payload.location === "string" ? payload.location : null,
          allDay: payload.allDay === true,
        })

        if (!created.connected || !created.created || created.error) {
          // Surface the resolvable calendars when the named one wasn't found, so the
          // user learns what they can write to instead of a bare "not found".
          const hint =
            created.availableCalendars && created.availableCalendars.length
              ? ` Calendars you can use: ${created.availableCalendars.join(", ")}.`
              : ""
          throw new Error((created.error || "Google Calendar event could not be created.") + hint)
        }

        const title = typeof payload.title === "string" ? payload.title : "event"
        summary = `Approved and created "${title}" on ${created.calendarSummary ?? "Google Calendar"}.`
        result = created
        auditAfter = { status: "completed", eventId: created.eventId ?? null, calendar: created.calendarSummary ?? null }
      } else {
        const synced = await syncTaskEventsToGoogleForUser(user.id)

        if (!synced.connected || synced.error) {
          throw new Error(synced.error || "Google Calendar is not connected.")
        }

        summary = `Approved and synced ${synced.synced} JARVIS task block${synced.synced === 1 ? "" : "s"} to Google Calendar.`
        result = synced
        auditAfter = { status: "completed", synced: synced.synced }
      }

      const executedAt = new Date().toISOString()

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
        action: `external.${action}.approve`,
        target_table: "assistant_tool_runs",
        target_id: toolRun.id,
        summary,
        before_value: {
          status: toolRun.status,
          requiresApproval: toolRun.requires_approval,
        },
        after_value: auditAfter,
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
