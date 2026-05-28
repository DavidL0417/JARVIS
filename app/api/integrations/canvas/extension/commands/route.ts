import { NextResponse } from "next/server"

import {
  CANVAS_EXTENSION_COMMAND_SELECT,
  CANVAS_EXTENSION_NODE_SELECT,
  isCanvasExtensionImportSelectableNode,
  mapCanvasExtensionCommand,
  mapCanvasExtensionNode,
  recordCanvasExtensionCommandEvent,
} from "@/lib/sources/canvas-extension-control"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { canvasExtensionCreateCommandRequestSchema, type CanvasExtensionNode } from "@/schemas/canvas-extension"

function isSafeCanvasCaptureUrl(value: string, canvasOrigin: string) {
  try {
    const url = new URL(value)
    const origin = new URL(canvasOrigin).origin
    const pathname = url.pathname.toLowerCase()
    const search = url.search.toLowerCase()

    if (url.origin !== origin) return false
    if (/\/quizzes\/[^/]+\/take(\/|$)/.test(pathname)) return false
    if (/\/quizzes\/[^/]+\/questions(\/|$)/.test(pathname)) return false
    if (/\/assignments\/[^/]+\/submissions\/new(\/|$)/.test(pathname)) return false
    if (/\/discussion_topics\/[^/]+\/replies(\/|$)/.test(pathname)) return false
    if (/\/conversations(\/|$)/.test(pathname)) return false
    if (/\/accounts(\/|$)/.test(pathname)) return false
    if (/[?&](submit|preview|take_quiz|download)=/i.test(search)) return false

    return true
  } catch {
    return false
  }
}

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
  const now = new Date().toISOString()
  const pendingResult = await adminClient
    .from("canvas_extension_commands")
    .update({
      status: "cancelled",
      result: { message: "Queued command cancelled from JARVIS." },
      completed_at: now,
      updated_at: now,
    })
    .eq("user_id", userId)
    .eq("status", "pending")
    .select(CANVAS_EXTENSION_COMMAND_SELECT)

  if (pendingResult.error) {
    throw new Error(pendingResult.error.message)
  }

  const runningResult = await adminClient
    .from("canvas_extension_commands")
    .update({ status: "cancel_requested", updated_at: now })
    .eq("user_id", userId)
    .eq("status", "running")
    .select(CANVAS_EXTENSION_COMMAND_SELECT)

  if (runningResult.error) {
    throw new Error(runningResult.error.message)
  }

  return [...(pendingResult.data || []), ...(runningResult.data || [])].map(mapCanvasExtensionCommand)
}

async function cancelPendingCommands(adminClient: Awaited<ReturnType<typeof requireAuthenticatedUser>>["adminClient"], userId: string) {
  const now = new Date().toISOString()
  const { data, error } = await adminClient
    .from("canvas_extension_commands")
    .update({
      status: "cancelled",
      result: { message: "Superseded by a newer Canvas command." },
      completed_at: now,
      updated_at: now,
    })
    .eq("user_id", userId)
    .eq("status", "pending")
    .select(CANVAS_EXTENSION_COMMAND_SELECT)

  if (error) {
    throw new Error(error.message)
  }

  const commands = (data || []).map(mapCanvasExtensionCommand)
  await Promise.all(commands.map((command) => recordCanvasExtensionCommandEvent({
    adminClient,
    userId,
    commandId: command.id,
    level: "warning",
    phase: "superseded",
    message: "Queued Canvas command superseded by a newer command.",
  })))

  return commands
}

async function runningCommand(adminClient: Awaited<ReturnType<typeof requireAuthenticatedUser>>["adminClient"], userId: string) {
  const { data, error } = await adminClient
    .from("canvas_extension_commands")
    .select(CANVAS_EXTENSION_COMMAND_SELECT)
    .eq("user_id", userId)
    .in("status", ["running", "cancel_requested"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data ? mapCanvasExtensionCommand(data) : null
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
      await Promise.all(commands.map((command) => recordCanvasExtensionCommandEvent({
        adminClient,
        userId: user.id,
        commandId: command.id,
        level: "warning",
        phase: "stop",
        message: "Stop requested from JARVIS.",
      })))
      return NextResponse.json({ success: true, commands })
    }

    const commandType: "discover" | "expand_node" | "import_selected" | "capture_url" = requestData.type === "resume"
      ? "import_selected"
      : requestData.type
    let nodeIds = requestData.nodeIds || []
    let targetNode: CanvasExtensionNode | null = null

    if (commandType === "import_selected" && nodeIds.length === 0) {
      nodeIds = await selectedImportNodeIds(adminClient, user.id)
    }

    if (commandType === "import_selected" && nodeIds.length === 0) {
      return NextResponse.json({ error: "Select at least one Canvas node before importing." }, { status: 400 })
    }

    if (commandType === "expand_node" && !requestData.targetNodeId) {
      return NextResponse.json({ error: "Choose a Canvas node to expand." }, { status: 400 })
    }

    if (commandType === "capture_url" && (!requestData.targetNodeId || !requestData.url)) {
      return NextResponse.json({ error: "Choose a Canvas node and link to capture." }, { status: 400 })
    }

    if (requestData.targetNodeId) {
      const { data: targetNodeRow, error: targetError } = await adminClient
        .from("canvas_extension_nodes")
        .select(CANVAS_EXTENSION_NODE_SELECT)
        .eq("user_id", user.id)
        .eq("id", requestData.targetNodeId)
        .maybeSingle()

      if (targetError) {
        throw new Error(targetError.message)
      }

      if (!targetNodeRow) {
        return NextResponse.json({ error: "Canvas node not found." }, { status: 404 })
      }

      targetNode = mapCanvasExtensionNode(targetNodeRow)
    }

    if (commandType === "capture_url" && requestData.url && targetNode && !isSafeCanvasCaptureUrl(requestData.url, targetNode.canvasOrigin)) {
      return NextResponse.json({ error: "Canvas Reader blocked this link because it is outside the safe read-only Canvas surface." }, { status: 400 })
    }

    const active = await runningCommand(adminClient, user.id)
    if (active) {
      return NextResponse.json(
        { error: "Canvas Reader is already running a command. Stop it before starting a new one." },
        { status: 409 },
      )
    }

    await cancelPendingCommands(adminClient, user.id)

    const { data, error } = await adminClient
      .from("canvas_extension_commands")
      .insert({
        user_id: user.id,
        type: commandType,
        target_node_id: requestData.targetNodeId ?? null,
        payload: { nodeIds, url: requestData.url ?? null },
      })
      .select(CANVAS_EXTENSION_COMMAND_SELECT)
      .single()

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to create Canvas extension command.")
    }

    const command = mapCanvasExtensionCommand(data)
    await recordCanvasExtensionCommandEvent({
      adminClient,
      userId: user.id,
      commandId: command.id,
      phase: command.type === "discover"
        ? "discover"
        : command.type === "expand_node"
          ? "expand"
          : command.type === "capture_url"
            ? "capture"
          : "import",
      nodeId: requestData.targetNodeId ?? null,
      message: command.type === "discover"
        ? "Queued course discovery from Canvas All Courses."
        : command.type === "expand_node"
          ? "Queued Canvas node expansion."
          : command.type === "capture_url"
            ? "Queued Canvas page capture from preview link."
          : `Queued import for ${nodeIds.length} selected Canvas node${nodeIds.length === 1 ? "" : "s"}.`,
      details: { nodeIds, url: requestData.url ?? null },
    })

    return NextResponse.json({ success: true, command })
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
