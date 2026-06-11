import { NextResponse } from "next/server"

import { consumeCanvasExtensionPairingCode } from "@/lib/supabase/canvas-extension-tokens"
import {
  canvasExtensionPairRequestSchema,
  canvasExtensionPairResponseSchema,
} from "@/schemas/canvas-extension"

function normalizeOrigin(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const url = new URL(value)
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.hostname === "localhost")) {
    throw new Error("Canvas origin must use HTTPS.")
  }

  return url.origin
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsedBody = canvasExtensionPairRequestSchema.safeParse(body)

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid Canvas extension pairing request.",
        issues: parsedBody.error.flatten(),
      },
      { status: 400 },
    )
  }

  try {
    const canvasOrigin = normalizeOrigin(parsedBody.data.canvasOrigin)
    const paired = await consumeCanvasExtensionPairingCode({
      code: parsedBody.data.code,
      canvasOrigin,
    })

    if (!paired) {
      return NextResponse.json(
        {
          error: "Canvas extension pairing code is invalid or expired.",
        },
        { status: 409 },
      )
    }

    return NextResponse.json(canvasExtensionPairResponseSchema.parse({
      success: true,
      extensionToken: paired.extensionToken,
      expiresAt: null,
    }))
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to pair Canvas extension.",
        details: error instanceof Error ? error.message : "Unknown pairing error.",
      },
      { status: 500 },
    )
  }
}
