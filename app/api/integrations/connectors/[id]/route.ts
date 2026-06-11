import { NextResponse } from "next/server"
import { z } from "zod"

import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { upsertConnectorEnabled } from "@/lib/supabase/connector-settings"
import { sourceConnectorIdSchema } from "@/schemas/common"

const connectorParamsSchema = z.object({
  id: sourceConnectorIdSchema,
})

const updateConnectorSettingsSchema = z.object({
  enabled: z.boolean(),
})

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = connectorParamsSchema.safeParse(await context.params)
  const body = await request.json().catch(() => null)
  const parsedBody = updateConnectorSettingsSchema.safeParse(body)

  if (!params.success) {
    return NextResponse.json({ error: "Invalid connector id." }, { status: 400 })
  }

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid connector settings request",
        issues: parsedBody.error.flatten(),
      },
      { status: 400 },
    )
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    await upsertConnectorEnabled({
      userId: user.id,
      connectorId: params.data.id,
      enabled: parsedBody.data.enabled,
      adminClient,
    })

    return NextResponse.json({
      success: true,
      connectorId: params.data.id,
      enabled: parsedBody.data.enabled,
    })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to update connector settings.",
        details: error instanceof Error ? error.message : "Unknown connector settings error.",
      },
      { status: 500 },
    )
  }
}
