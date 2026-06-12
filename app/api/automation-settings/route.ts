import { NextResponse } from "next/server"
import { z } from "zod"

import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import {
  getAutomationSettings,
  isAutomationPaused,
  setAutomationPaused,
} from "@/lib/supabase/automation-settings"

const updateAutomationSettingsSchema = z.object({
  paused: z.boolean(),
  pausedUntil: z.string().datetime().nullable().optional(),
  pausedReason: z.string().max(280).nullable().optional(),
})

export async function GET() {
  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const settings = await getAutomationSettings(user.id, adminClient)

    return NextResponse.json({
      paused: isAutomationPaused(settings),
      pausedFlag: settings.paused,
      pausedUntil: settings.pausedUntil,
      pausedReason: settings.pausedReason,
    })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      { error: "Failed to load automation settings." },
      { status: 500 },
    )
  }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = updateAutomationSettingsSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid automation settings request", issues: parsed.error.flatten() },
      { status: 400 },
    )
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const settings = await setAutomationPaused({
      userId: user.id,
      paused: parsed.data.paused,
      pausedUntil: parsed.data.pausedUntil ?? null,
      pausedReason: parsed.data.pausedReason ?? null,
      adminClient,
    })

    return NextResponse.json({
      success: true,
      paused: isAutomationPaused(settings),
      pausedFlag: settings.paused,
      pausedUntil: settings.pausedUntil,
      pausedReason: settings.pausedReason,
    })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to update automation settings.",
        details: error instanceof Error ? error.message : "Unknown automation settings error.",
      },
      { status: 500 },
    )
  }
}
