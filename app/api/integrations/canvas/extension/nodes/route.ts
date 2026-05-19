import { NextResponse } from "next/server"

import {
  updateCanvasExtensionNodeSelection,
} from "@/lib/sources/canvas-extension-control"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { canvasExtensionSelectNodeRequestSchema } from "@/schemas/canvas-extension"

export async function PATCH(request: Request) {
  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const body = await request.json().catch(() => null)
    const parsedBody = canvasExtensionSelectNodeRequestSchema.safeParse(body)

    if (!parsedBody.success) {
      return NextResponse.json(
        {
          error: "Invalid Canvas node selection request.",
          issues: parsedBody.error.flatten(),
        },
        { status: 400 },
      )
    }

    const node = await updateCanvasExtensionNodeSelection({
      adminClient,
      userId: user.id,
      nodeId: parsedBody.data.nodeId,
      selected: parsedBody.data.selected,
    })

    if (!node) {
      return NextResponse.json({ error: "Canvas node not found." }, { status: 404 })
    }

    return NextResponse.json({ success: true, node })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to update Canvas node selection.",
        details: error instanceof Error ? error.message : "Unknown Canvas node error.",
      },
      { status: 500 },
    )
  }
}
