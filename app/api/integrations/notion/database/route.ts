import { NextResponse } from "next/server"

import {
  extractNotionId,
  fetchNotionJson,
  getNotionTitle,
  type NotionDatabaseResult,
  type NotionSearchResponse,
} from "@/lib/notion"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { getStoredIntegrationToken } from "@/lib/supabase/integration-tokens"

function isMissingSelectedSourceColumn(error: { message?: string; code?: string }) {
  return Boolean(
    error &&
      (error.code === "42703" ||
        /selected_source_id|selected_source_name|does not exist/i.test(error.message ?? "")),
  )
}

async function requireNotionAccessToken(userId: string) {
  const token = await getStoredIntegrationToken(userId, "notion")

  if (!token?.access_token) {
    throw new Error("NOTION_NOT_CONNECTED")
  }

  return token.access_token
}

function databaseSummary(database: NotionDatabaseResult) {
  return {
    id: database.id ?? "",
    name: getNotionTitle(database.title) || "Untitled database",
    url: database.url ?? null,
  }
}

export async function GET(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser()
    const accessToken = await requireNotionAccessToken(user.id)
    const url = new URL(request.url)
    const query = url.searchParams.get("query")?.trim() || undefined
    const payload = await fetchNotionJson<NotionSearchResponse>(accessToken, "https://api.notion.com/v1/search", {
      method: "POST",
      body: JSON.stringify({
        query,
        page_size: 20,
        filter: {
          property: "object",
          value: "database",
        },
        sort: {
          direction: "descending",
          timestamp: "last_edited_time",
        },
      }),
    })

    return NextResponse.json({
      success: true,
      databases: (payload.results || [])
        .filter((database) => database.id && !database.archived)
        .map(databaseSummary),
    })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    const message = error instanceof Error ? error.message : "Unknown Notion database lookup error."

    if (message === "NOTION_NOT_CONNECTED") {
      return NextResponse.json(
        {
          error: "Notion is not connected.",
          needsAuthorization: true,
        },
        { status: 409 },
      )
    }

    return NextResponse.json(
      {
        error: "Failed to load Notion databases.",
        details: message,
      },
      { status: 500 },
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const accessToken = await requireNotionAccessToken(user.id)
    const body = (await request.json().catch(() => ({}))) as { database?: string; databaseName?: string | null }
    const databaseId = extractNotionId(body.database ?? "")

    if (!databaseId) {
      return NextResponse.json(
        {
          error: "Paste a valid Notion database URL or database ID.",
        },
        { status: 400 },
      )
    }

    const database = await fetchNotionJson<NotionDatabaseResult>(
      accessToken,
      `https://api.notion.com/v1/databases/${encodeURIComponent(databaseId)}`,
    )
    const databaseName =
      getNotionTitle(database.title) ||
      body.databaseName?.trim() ||
      "Notion tasks database"
    const { error } = await adminClient
      .from("integrations")
      .update({
        status: "connected",
        selected_source_id: databaseId,
        selected_source_name: databaseName,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id)
      .eq("provider", "notion")

    if (error) {
      if (isMissingSelectedSourceColumn(error)) {
        return NextResponse.json(
          {
            error: "The Notion tasks database migration has not been applied yet. Apply the pending Supabase migration, then save the authoritative tasks database again.",
          },
          { status: 409 },
        )
      }

      throw new Error(error.message)
    }

    return NextResponse.json({
      success: true,
      database: {
        id: databaseId,
        name: databaseName,
        url: database.url ?? null,
      },
    })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    const message = error instanceof Error ? error.message : "Unknown Notion database save error."

    if (message === "NOTION_NOT_CONNECTED") {
      return NextResponse.json(
        {
          error: "Notion is not connected.",
          needsAuthorization: true,
        },
        { status: 409 },
      )
    }

    if (message.startsWith("NOTION_DATABASE_NOT_FOUND:")) {
      return NextResponse.json(
        {
          error: "JARVIS cannot read that Notion database. Share it with the Notion connection, then save it again.",
          details: message.replace("NOTION_DATABASE_NOT_FOUND:", "").trim(),
        },
        { status: 404 },
      )
    }

    return NextResponse.json(
      {
        error: "Failed to save Notion tasks database.",
        details: message,
      },
      { status: 500 },
    )
  }
}
