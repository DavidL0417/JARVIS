import { NextResponse } from "next/server"
import { z } from "zod"

import {
  CanvasApiError,
  normalizeCanvasBaseUrl,
  validateCanvasConnection,
} from "@/lib/canvas"
import { upsertCanvasIntegration } from "@/lib/supabase/canvas-integration"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"

const canvasConnectRequestSchema = z.object({
  baseUrl: z.string().trim().min(1),
  accessToken: z.string().trim().min(1),
})

function providerUserId(profile: Awaited<ReturnType<typeof validateCanvasConnection>>) {
  if (profile.id === null || profile.id === undefined) {
    return null
  }

  return String(profile.id)
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsedBody = canvasConnectRequestSchema.safeParse(body)

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid Canvas connection request",
        issues: parsedBody.error.flatten(),
      },
      { status: 400 },
    )
  }

  try {
    const { user } = await requireAuthenticatedUser()
    const baseUrl = normalizeCanvasBaseUrl(parsedBody.data.baseUrl)
    const accessToken = parsedBody.data.accessToken.trim()
    const profile = await validateCanvasConnection({ baseUrl, accessToken })
    const accountLabel = profile.name || profile.short_name || profile.sortable_name || null

    await upsertCanvasIntegration({
      userId: user.id,
      baseUrl,
      accessToken,
      accountLabel,
      providerUserId: providerUserId(profile),
      providerAccountEmail: profile.primary_email || profile.login_id || null,
    })

    return NextResponse.json({
      success: true,
      account: profile.primary_email || profile.login_id || accountLabel || new URL(baseUrl).host,
      baseUrl,
    })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    if (error instanceof CanvasApiError && error.reauthorizationRequired) {
      return NextResponse.json(
        {
          error: "Canvas rejected the access token.",
          details: error.message,
          needsAuthorization: true,
        },
        { status: 409 },
      )
    }

    return NextResponse.json(
      {
        error: "Failed to connect Canvas.",
        details: error instanceof Error ? error.message : "Unknown Canvas connection error.",
      },
      { status: 500 },
    )
  }
}
