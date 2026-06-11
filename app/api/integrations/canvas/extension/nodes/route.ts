import { NextResponse } from "next/server"

import {
  deleteCanvasExtensionNode,
  updateCanvasExtensionNodeSelection,
} from "@/lib/sources/canvas-extension-control"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { canvasExtensionSelectNodeRequestSchema } from "@/schemas/canvas-extension"
import { z } from "zod"

const deleteNodeRequestSchema = z.object({ nodeId: z.string().uuid() })

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

export async function DELETE(request: Request) {
  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const body = await request.json().catch(() => null)
    const parsedBody = deleteNodeRequestSchema.safeParse(body)

    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "Invalid Canvas node delete request.", issues: parsedBody.error.flatten() },
        { status: 400 },
      )
    }

    const deleted = await deleteCanvasExtensionNode({
      adminClient,
      userId: user.id,
      nodeId: parsedBody.data.nodeId,
    })

    if (!deleted) {
      return NextResponse.json({ error: "Canvas node not found." }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to delete Canvas node.",
        details: error instanceof Error ? error.message : "Unknown Canvas node error.",
      },
      { status: 500 },
    )
  }
}
