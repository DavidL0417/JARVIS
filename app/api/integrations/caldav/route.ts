import { NextResponse } from "next/server"
import { z } from "zod"

import { APPLE_CALDAV_SERVER_URL } from "@/lib/caldav/constants"
import { verifyCalDavConnection } from "@/lib/caldav/refresh"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { upsertCalDavIntegration } from "@/lib/supabase/caldav-integration"

const calDavConnectionSchema = z
  .object({
    serverUrl: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim().length === 0
          ? undefined
          : value,
      z.string().trim().url().optional(),
    ),
    username: z.string().trim().min(1),
    password: z.string().trim().min(1),
  })
  .transform((input) => ({
    ...input,
    serverUrl: input.serverUrl ?? APPLE_CALDAV_SERVER_URL,
  }))

function isProviderConstraintError(error: unknown) {
  return error instanceof Error && error.message.includes("integrations_provider_check")
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsedBody = calDavConnectionSchema.safeParse(body)

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid CalDAV connection request",
        issues: parsedBody.error.flatten(),
      },
      { status: 400 },
    )
  }

  try {
    const { user } = await requireAuthenticatedUser()
    const calendars = await verifyCalDavConnection(parsedBody.data)
    await upsertCalDavIntegration({
      userId: user.id,
      ...parsedBody.data,
    })

    return NextResponse.json({
      success: true,
      details: `Connected CalDAV and found ${calendars.length} calendar${calendars.length === 1 ? "" : "s"}.`,
    })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "CalDAV connection failed.",
        details: isProviderConstraintError(error)
          ? "The database provider constraint is missing CalDAV. Apply the latest Supabase migration before connecting Apple Calendar."
          : error instanceof Error
            ? error.message
            : "Unknown CalDAV connection error.",
      },
      { status: 500 },
    )
  }
}
