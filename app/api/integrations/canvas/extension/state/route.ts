import { NextResponse } from "next/server"

import {
  CANVAS_EXTENSION_COMMAND_SELECT,
  CANVAS_EXTENSION_NODE_SELECT,
  CANVAS_EXTENSION_SESSION_SELECT,
  isCanvasExtensionVisibleNode,
  mapCanvasExtensionCommand,
  mapCanvasExtensionNode,
  mapCanvasExtensionSession,
} from "@/lib/sources/canvas-extension-control"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { canvasExtensionStateResponseSchema } from "@/schemas/canvas-extension"

export async function GET() {
  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const [sessionResult, commandResult, nodeResult] = await Promise.all([
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
    ])

    if (sessionResult.error || commandResult.error || nodeResult.error) {
      throw new Error(
        sessionResult.error?.message ||
          commandResult.error?.message ||
          nodeResult.error?.message ||
          "Failed to load Canvas extension state.",
      )
    }

    return NextResponse.json(canvasExtensionStateResponseSchema.parse({
      success: true,
      session: sessionResult.data ? mapCanvasExtensionSession(sessionResult.data) : null,
      commands: (commandResult.data || []).map(mapCanvasExtensionCommand),
      nodes: (nodeResult.data || []).map(mapCanvasExtensionNode).filter(isCanvasExtensionVisibleNode),
    }))
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to load Canvas extension state.",
        details: error instanceof Error ? error.message : "Unknown Canvas extension state error.",
      },
      { status: 500 },
    )
  }
}
