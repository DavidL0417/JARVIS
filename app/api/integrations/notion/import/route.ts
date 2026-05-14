import { NextResponse } from "next/server"

import { refreshNotionForUser } from "@/lib/sources/notion-refresh"
import { insertSourceSnapshot } from "@/lib/sources/persistence"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { sourceIntakeResponseSchema } from "@/schemas/sources"

function parseNotionRefreshError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown Notion import error."
  const needsAuthorization = message.startsWith("NOTION_REAUTH_REQUIRED:")
  const needsDatabaseSelection = message.startsWith("NOTION_DATABASE_NOT_SELECTED:")
  const databaseNotReadable = message.startsWith("NOTION_DATABASE_NOT_FOUND:")
  const details = message
    .replace("NOTION_REAUTH_REQUIRED:", "")
    .replace("NOTION_DATABASE_NOT_SELECTED:", "")
    .replace("NOTION_DATABASE_NOT_FOUND:", "")
    .trim()

  if (needsAuthorization) {
    return {
      status: 409,
      error: details || "Notion is not connected.",
      details,
      needsAuthorization: true,
      needsDatabaseSelection: false,
      reason: "reauthorization_required",
    }
  }

  if (needsDatabaseSelection) {
    return {
      status: 409,
      error: details || "Choose the authoritative Notion tasks database before importing.",
      details,
      needsAuthorization: false,
      needsDatabaseSelection: true,
      reason: "database_not_selected",
    }
  }

  if (databaseNotReadable) {
    return {
      status: 409,
      error: "The selected Notion tasks database could not be read. Share it with the Notion connection or choose a different database.",
      details,
      needsAuthorization: false,
      needsDatabaseSelection: true,
      reason: "database_not_readable",
    }
  }

  return {
    status: 500,
    error: "Failed to import Notion tasks database.",
    details: details || message,
    needsAuthorization: false,
    needsDatabaseSelection: false,
    reason: "notion_import_failed",
  }
}

export async function POST() {
  let userId: string | null = null

  try {
    const { user } = await requireAuthenticatedUser()
    userId = user.id
    const responsePayload = await refreshNotionForUser(user.id)
    return NextResponse.json(sourceIntakeResponseSchema.parse(responsePayload))
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    const parsedError = parseNotionRefreshError(error)

    if (userId) {
      try {
        const { adminClient } = await requireAuthenticatedUser()
        await insertSourceSnapshot({
          adminClient,
          userId,
          source: "notion",
          sourceRef: null,
          freshness: "failed",
          summary: parsedError.details || parsedError.error,
          payload: {
            reason: parsedError.reason,
          },
        })
      } catch (recordError) {
        console.error("Failed to record Notion import failure state.", recordError)
      }
    }

    return NextResponse.json(
      {
        error: parsedError.error,
        details: parsedError.details,
        needsAuthorization: parsedError.needsAuthorization,
        needsDatabaseSelection: parsedError.needsDatabaseSelection,
      },
      { status: parsedError.status },
    )
  }
}
