import { NextResponse } from "next/server"

import {
  CANVAS_EXTENSION_COMMAND_SELECT,
  CANVAS_EXTENSION_COMMAND_EVENT_SELECT,
  CANVAS_EXTENSION_NODE_SELECT,
  CANVAS_EXTENSION_SESSION_SELECT,
  isCanvasExtensionVisibleNode,
  mapCanvasExtensionCommand,
  mapCanvasExtensionCommandEvent,
  mapCanvasExtensionNode,
  mapCanvasExtensionSession,
} from "@/lib/sources/canvas-extension-control"
import {
  isAuthBackendDependencyError,
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import type {
  CanvasExtensionCommand,
  CanvasExtensionCommandEvent,
  CanvasExtensionHealth,
  CanvasExtensionSession,
} from "@/schemas/canvas-extension"
import { canvasExtensionStateResponseSchema } from "@/schemas/canvas-extension"

function activeCommand(commands: CanvasExtensionCommand[]) {
  const oldestFirst = [...commands].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
  return oldestFirst.find((command) => ["running", "cancel_requested"].includes(command.status)) ??
    oldestFirst.find((command) => command.status === "pending") ??
    null
}

function extensionStatus(session: CanvasExtensionSession | null): CanvasExtensionHealth["extensionStatus"] {
  if (!session) return "offline"

  return Date.now() - new Date(session.lastSeenAt).getTime() < 90_000 ? "connected" : "stale"
}

function recoverableActions(input: {
  session: CanvasExtensionSession | null
  active: CanvasExtensionCommand | null
  lastEvent: CanvasExtensionCommandEvent | null
}): CanvasExtensionHealth["recoverableActions"] {
  const actions = new Set<CanvasExtensionHealth["recoverableActions"][number]>(["retry_state"])
  const status = extensionStatus(input.session)

  if (status === "connected" || status === "stale") {
    actions.add("wake_extension")
  } else {
    actions.add("create_pairing_code")
    actions.add("open_canvas")
  }

  if (input.active?.status === "running" || input.active?.status === "pending") {
    actions.add("stop_command")
  }

  if (input.lastEvent?.phase === "import" && input.lastEvent.level === "error") {
    actions.add("resume_import")
  }

  return Array.from(actions)
}

function stateErrorResponse(input: {
  status: number
  errorCode: "auth_required" | "backend_timeout" | "backend_error"
  message: string
  details?: string
}) {
  return NextResponse.json(
    {
      success: false,
      errorCode: input.errorCode,
      error: input.message,
      details: input.details ?? input.message,
      health: {
        authStatus: input.errorCode,
        extensionStatus: "unknown",
        activeCommand: null,
        lastEvent: null,
        recoverableActions: input.errorCode === "auth_required" ? ["sign_in"] : ["retry_state"],
      },
    },
    { status: input.status },
  )
}

export async function GET() {
  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const [sessionResult, commandResult, nodeResult, eventResult] = await Promise.all([
      adminClient
        .from("canvas_extension_sessions")
        .select(CANVAS_EXTENSION_SESSION_SELECT)
        .eq("user_id", user.id)
        .maybeSingle(),
      adminClient
        .from("canvas_extension_commands")
        .select(CANVAS_EXTENSION_COMMAND_SELECT)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50),
      adminClient
        .from("canvas_extension_nodes")
        .select(CANVAS_EXTENSION_NODE_SELECT)
        .eq("user_id", user.id)
        .order("title", { ascending: true })
        .limit(1000),
      adminClient
        .from("canvas_extension_command_events")
        .select(CANVAS_EXTENSION_COMMAND_EVENT_SELECT)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(80),
    ])

    if (sessionResult.error || commandResult.error || nodeResult.error || eventResult.error) {
      throw new Error(
        sessionResult.error?.message ||
          commandResult.error?.message ||
          nodeResult.error?.message ||
          eventResult.error?.message ||
          "Failed to load Canvas extension state.",
      )
    }

    const session = sessionResult.data ? mapCanvasExtensionSession(sessionResult.data) : null
    const commands = (commandResult.data || []).map(mapCanvasExtensionCommand)
    const events = (eventResult.data || []).map(mapCanvasExtensionCommandEvent)
    const active = activeCommand(commands)
    const lastEvent = events[0] ?? null

    return NextResponse.json(canvasExtensionStateResponseSchema.parse({
      success: true,
      health: {
        authStatus: "signed_in",
        extensionStatus: extensionStatus(session),
        activeCommand: active,
        lastEvent,
        recoverableActions: recoverableActions({ session, active, lastEvent }),
      },
      session,
      commands,
      nodes: (nodeResult.data || []).map(mapCanvasExtensionNode).filter(isCanvasExtensionVisibleNode),
      events,
    }))
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return stateErrorResponse({
        status: 401,
        errorCode: "auth_required",
        message: "Authentication required.",
      })
    }

    if (isAuthBackendDependencyError(error)) {
      return stateErrorResponse({
        status: error.code === "backend_timeout" ? 503 : 502,
        errorCode: error.code,
        message: error.code === "backend_timeout" ? "Supabase auth timed out." : "Supabase auth failed.",
        details: error.message,
      })
    }

    return stateErrorResponse({
      status: 500,
      errorCode: "backend_error",
      message: "Failed to load Canvas extension state.",
      details: error instanceof Error ? error.message : "Unknown Canvas extension state error.",
    })
  }
}
