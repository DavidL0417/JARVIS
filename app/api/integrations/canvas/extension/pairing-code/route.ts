import { NextResponse } from "next/server"

import {
  canvasExtensionPairingExpiresAt,
  createCanvasExtensionPairingCode,
  insertCanvasExtensionPairingCode,
} from "@/lib/supabase/canvas-extension-tokens"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { canvasExtensionPairingCodeResponseSchema } from "@/schemas/canvas-extension"

export async function POST() {
  try {
    const { user } = await requireAuthenticatedUser()
    const code = createCanvasExtensionPairingCode()
    const expiresAt = canvasExtensionPairingExpiresAt()

    await insertCanvasExtensionPairingCode({
      userId: user.id,
      code,
      expiresAt,
    })

    return NextResponse.json(canvasExtensionPairingCodeResponseSchema.parse({
      success: true,
      code,
      expiresAt,
    }))
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to create Canvas extension pairing code.",
        details: error instanceof Error ? error.message : "Unknown pairing-code error.",
      },
      { status: 500 },
    )
  }
}
