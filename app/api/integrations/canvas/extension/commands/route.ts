import { NextResponse } from "next/server"

import {
  CANVAS_EXTENSION_COMMAND_SELECT,
  CANVAS_EXTENSION_NODE_SELECT,
  isCanvasExtensionImportSelectableNode,
  mapCanvasExtensionCommand,
  mapCanvasExtensionNode,
} from "@/lib/sources/canvas-extension-control"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { canvasExtensionCreateCommandRequestSchema } from "@/schemas/canvas-extension"

async function selectedImportNodeIds(adminClient: Awaited<ReturnType<typeof requireAuthenticatedUser>>["adminClient"], userId: string) {
  const { data, error } = await adminClient
    .from("canvas_extension_nodes")
    .select(CANVAS_EXTENSION_NODE_SELECT)
    .eq("user_id", userId)
    .eq("selected", true)
    .is("imported_at", null)
    .limit(200)

  if (error) {
    throw new Error(error.message)
  }

  return (data || []).map(mapCanvasExtensionNode).filter(isCanvasExtensionImportSelectableNode).map((node) => node.id)
}

async function stopActiveCommand(adminClient: Awaited<ReturnType<typeof requireAuthenticatedUser>>["adminClient"], userId: string) {
  const { data, error } = await adminClient
    .from("canvas_extension_commands")
    .update({ status: "cancel_requested", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .in("status", ["pending", "running"])
    .select(CANVAS_EXTENSION_COMMAND_SELECT)

  if (error) {
    throw new Error(error.message)
  }

  return (data || []).map(mapCanvasExtensionCommand)
}

export async function POST(request: Request) {
  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const body = await request.json().catch(() => null)
    const parsedBody = canvasExtensionCreateCommandRequestSchema.safeParse(body)

    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: "Invalid Canvas extension command request.",
          issues: parsedBody.error.flatten(),
        },
        { status: 400 },
      )
    }

    const requestData = parsedBody.data

    if (requestData.type === "stop") {
      const commands = await stopActiveCommand(adminClient, user.id)
      return NextResponse.json({ success: true, commands })
    }

    const commandType: "discover" | "expand_node" | "import_selected" = requestData.type === "resume"
      ? "import_selected"
      : requestData.type
    let nodeIds = requestData.nodeIds || []

    if (commandType === "import_selected" && nodeIds.length === 0) {
      nodeIds = await selectedImportNodeIds(adminClient, user.id)
    }

    if (commandType === "import_selected" && nodeIds.length === 0) {
      return NextResponse.json({ error: "Select at least one Canvas node before importing." }, { status: 400 })
    }

    if (commandType === "expand_node" && !requestData.targetNodeId) {
      return NextResponse.json({ error: "Choose a Canvas node to expand." }, { status: 400 })
    }

    if (requestData.targetNodeId) {
      const { data: targetNode, error: targetError } = await adminClient
        .from("canvas_extension_nodes")
        .select(CANVAS_EXTENSION_NODE_SELECT)
        .eq("user_id", user.id)
        .eq("id", requestData.targetNodeId)
        .maybeSingle()

      if (targetError) {
        throw new Error(targetError.message)
      }

      if (!targetNode) {
        return NextResponse.json({ error: "Canvas node not found." }, { status: 404 })
      }
    }

    const { data, error } = await adminClient
      .from("canvas_extension_commands")
      .insert({
        user_id: user.id,
        type: commandType,
        target_node_id: requestData.targetNodeId ?? null,
        payload: { nodeIds },
      })
      .select(CANVAS_EXTENSION_COMMAND_SELECT)
      .single()

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to create Canvas extension command.")
    }

    return NextResponse.json({ success: true, command: mapCanvasExtensionCommand(data) })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to create Canvas extension command.",
        details: error instanceof Error ? error.message : "Unknown Canvas extension command error.",
      },
      { status: 500 },
    )
  }
}
