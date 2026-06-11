import { NextResponse } from "next/server"

import {
  CANVAS_EXTENSION_COMMAND_SELECT,
  deleteCanvasExtensionChildren,
  deleteCanvasExtensionRootNonCourseNodes,
  mapCanvasExtensionCommand,
  recordCanvasExtensionCommandEvent,
  upsertCanvasExtensionNodes,
} from "@/lib/sources/canvas-extension-control"
import { requireCanvasExtensionToken } from "@/lib/supabase/canvas-extension-auth"
import { canvasExtensionWorkerReportRequestSchema } from "@/schemas/canvas-extension"

export async function POST(request: Request) {
  try {
    const auth = await requireCanvasExtensionToken(request)

    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const body = await request.json().catch(() => null)
    const parsedBody = canvasExtensionWorkerReportRequestSchema.safeParse(body)

    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: "Invalid Canvas extension worker report.",
          issues: parsedBody.error.flatten(),
        },
        { status: 400 },
      )
    }

    const { adminClient, tokenRecord } = auth
    const report = parsedBody.data
    const commandResult = await adminClient
      .from("canvas_extension_commands")
      .select(CANVAS_EXTENSION_COMMAND_SELECT)
      .eq("user_id", tokenRecord.user_id)
      .eq("id", report.commandId)
      .maybeSingle()

    if (commandResult.error) {
      throw new Error(commandResult.error.message)
    }

    if (!commandResult.data) {
      return NextResponse.json({ error: "Canvas extension command not found." }, { status: 404 })
    }

    if (report.message) {
      await recordCanvasExtensionCommandEvent({
        adminClient,
        userId: tokenRecord.user_id,
        commandId: report.commandId,
        level: report.level ?? (report.status === "failed" ? "error" : report.status === "succeeded" ? "success" : "info"),
        phase: report.phase ?? (report.status === "succeeded" ? "complete" : report.status === "failed" ? "failed" : "status"),
        nodeId: report.nodeId ?? null,
        message: report.message,
        details: report.details ?? report.result ?? {},
      })
    }

    if (commandResult.data.type === "expand_node" && commandResult.data.target_node_id && report.status === "succeeded") {
      await deleteCanvasExtensionChildren({
        adminClient,
        userId: tokenRecord.user_id,
        parentNodeId: commandResult.data.target_node_id,
      })
    }

    if (report.nodes?.length) {
      if (commandResult.data.type === "discover") {
        await deleteCanvasExtensionRootNonCourseNodes({
          adminClient,
          userId: tokenRecord.user_id,
          canvasOrigins: report.nodes.map((node) => node.canvasOrigin),
        })
      }

      await upsertCanvasExtensionNodes({
        adminClient,
        userId: tokenRecord.user_id,
        nodes: report.nodes.map((node) => ({
          parentId: node.parentId,
          parentUrl: node.parentUrl,
          canvasOrigin: node.canvasOrigin,
          url: node.url,
          title: node.title,
          kind: node.kind,
          textPreview: node.textPreview,
          metadata: node.metadata,
          selected: node.selected,
          expanded: node.expanded,
        })),
      })
    }

    for (const importedNode of report.importedNodes || []) {
      await adminClient
        .from("canvas_extension_nodes")
        .update({
          imported_at: importedNode.importedAt ?? new Date().toISOString(),
          source_snapshot_id: importedNode.sourceSnapshotId ?? null,
          source_file_id: importedNode.sourceFileId ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", tokenRecord.user_id)
        .eq("id", importedNode.nodeId)
    }

    const previousResult = commandResult.data.result && typeof commandResult.data.result === "object"
      ? commandResult.data.result as Record<string, unknown>
      : {}
    const nextResult = {
      ...previousResult,
      ...(report.result || {}),
      message: report.message ?? previousResult.message ?? null,
      updatedAt: new Date().toISOString(),
    }

    let nextStatus = commandResult.data.status
    let completedAt: string | null = commandResult.data.completed_at
    let errorMessage: string | null = commandResult.data.error_message

    if (report.status === "succeeded") {
      nextStatus = "succeeded"
      completedAt = new Date().toISOString()
    } else if (report.status === "failed") {
      nextStatus = "failed"
      completedAt = new Date().toISOString()
      errorMessage = report.message ?? "Canvas extension command failed."
    } else if (report.status === "cancelled") {
      nextStatus = "cancelled"
      completedAt = new Date().toISOString()
      errorMessage = report.message ?? null
    }

    const updateResult = await adminClient
      .from("canvas_extension_commands")
      .update({
        status: nextStatus,
        result: nextResult,
        error_message: errorMessage,
        completed_at: completedAt,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", tokenRecord.user_id)
      .eq("id", report.commandId)
      .select(CANVAS_EXTENSION_COMMAND_SELECT)
      .single()

    if (updateResult.error) {
      throw new Error(updateResult.error.message)
    }

    if (["succeeded", "failed", "cancelled"].includes(nextStatus)) {
      await adminClient
        .from("canvas_extension_sessions")
        .update({ active_command_id: null, updated_at: new Date().toISOString() })
        .eq("user_id", tokenRecord.user_id)

      if (commandResult.data.type === "expand_node" && commandResult.data.target_node_id && report.status === "succeeded") {
        await adminClient
          .from("canvas_extension_nodes")
          .update({ expanded: true, updated_at: new Date().toISOString() })
          .eq("user_id", tokenRecord.user_id)
          .eq("id", commandResult.data.target_node_id)
      }
    }

    return NextResponse.json({
      success: true,
      command: mapCanvasExtensionCommand(updateResult.data),
      cancelRequested: commandResult.data.status === "cancel_requested",
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to record Canvas extension worker report.",
        details: error instanceof Error ? error.message : "Unknown Canvas extension worker report error.",
      },
      { status: 500 },
    )
  }
}
