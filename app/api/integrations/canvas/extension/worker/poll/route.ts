import { NextResponse } from "next/server"

import {
  CANVAS_EXTENSION_COMMAND_SELECT,
  CANVAS_EXTENSION_NODE_SELECT,
  mapCanvasExtensionCommand,
  mapCanvasExtensionNode,
  recordCanvasExtensionCommandEvent,
} from "@/lib/sources/canvas-extension-control"
import { requireCanvasExtensionToken } from "@/lib/supabase/canvas-extension-auth"
import { canvasExtensionWorkerPollRequestSchema } from "@/schemas/canvas-extension"

async function upsertIntegration(input: {
  adminClient: NonNullable<Awaited<ReturnType<typeof requireCanvasExtensionToken>>["adminClient"]>
  userId: string
  canvasOrigin: string | null
}) {
  const { error } = await input.adminClient.from("integrations").upsert(
    {
      user_id: input.userId,
      provider: "canvas",
      provider_account_email: null,
      provider_user_id: null,
      status: "connected",
      selected_calendar_id: null,
      selected_source_id: input.canvasOrigin,
      selected_source_name: input.canvasOrigin ? new URL(input.canvasOrigin).host : "Canvas Reader extension",
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" },
  )

  if (error) {
    throw new Error(error.message)
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireCanvasExtensionToken(request)

    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const body = await request.json().catch(() => null)
    const parsedBody = canvasExtensionWorkerPollRequestSchema.safeParse(body)

    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: "Invalid Canvas extension poll request.",
          issues: parsedBody.error.flatten(),
        },
        { status: 400 },
      )
    }

    const { adminClient, tokenRecord } = auth
    const poll = parsedBody.data
    const canvasOrigin = poll.canvasOrigin ? new URL(poll.canvasOrigin).origin : tokenRecord.canvas_origin

    const { error: sessionError } = await adminClient.from("canvas_extension_sessions").upsert(
      {
        user_id: tokenRecord.user_id,
        token_id: tokenRecord.id,
        status: "connected",
        extension_version: poll.extensionVersion ?? null,
        canvas_origin: canvasOrigin,
        active_url: poll.activeUrl ?? null,
        active_title: poll.activeTitle ?? null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )

    if (sessionError) {
      throw new Error(sessionError.message)
    }

    await upsertIntegration({ adminClient, userId: tokenRecord.user_id, canvasOrigin })

    const runningResult = await adminClient
      .from("canvas_extension_commands")
      .select(CANVAS_EXTENSION_COMMAND_SELECT)
      .eq("user_id", tokenRecord.user_id)
      .in("status", ["running", "cancel_requested"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()

    if (runningResult.error) {
      throw new Error(runningResult.error.message)
    }

    let commandRow = runningResult.data

    if (!commandRow) {
      const pendingResult = await adminClient
        .from("canvas_extension_commands")
        .select(CANVAS_EXTENSION_COMMAND_SELECT)
        .eq("user_id", tokenRecord.user_id)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle()

      if (pendingResult.error) {
        throw new Error(pendingResult.error.message)
      }

      if (pendingResult.data) {
        const updateResult = await adminClient
          .from("canvas_extension_commands")
          .update({
            status: "running",
            started_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", pendingResult.data.id)
          .eq("user_id", tokenRecord.user_id)
          .select(CANVAS_EXTENSION_COMMAND_SELECT)
          .single()

        if (updateResult.error) {
          throw new Error(updateResult.error.message)
        }

        commandRow = updateResult.data

        await adminClient
          .from("canvas_extension_sessions")
          .update({ active_command_id: commandRow.id })
          .eq("user_id", tokenRecord.user_id)

        await recordCanvasExtensionCommandEvent({
          adminClient,
          userId: tokenRecord.user_id,
          commandId: commandRow.id,
          phase: "claimed",
          message: "Canvas Reader claimed the queued command.",
          details: {
            canvasOrigin,
            activeUrl: poll.activeUrl ?? null,
            extensionVersion: poll.extensionVersion ?? null,
          },
        })
      }
    }

    if (!commandRow) {
      return NextResponse.json({ success: true, command: null })
    }

    const nodeIds = Array.isArray(commandRow.payload?.nodeIds)
      ? commandRow.payload.nodeIds.filter((id: unknown): id is string => typeof id === "string")
      : []
    const nodeQueryIds = commandRow.target_node_id ? [commandRow.target_node_id, ...nodeIds] : nodeIds
    const nodeResult = nodeQueryIds.length > 0
      ? await adminClient
          .from("canvas_extension_nodes")
          .select(CANVAS_EXTENSION_NODE_SELECT)
          .eq("user_id", tokenRecord.user_id)
          .in("id", nodeQueryIds)
      : { data: [], error: null }

    if (nodeResult.error) {
      throw new Error(nodeResult.error.message)
    }

    return NextResponse.json({
      success: true,
      command: mapCanvasExtensionCommand(commandRow),
      nodes: (nodeResult.data || []).map(mapCanvasExtensionNode),
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to poll Canvas extension command queue.",
        details: error instanceof Error ? error.message : "Unknown Canvas extension worker error.",
      },
      { status: 500 },
    )
  }
}
