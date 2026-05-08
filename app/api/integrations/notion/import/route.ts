import { NextResponse } from "next/server"

import { extractCandidatesFromText } from "@/lib/sources/extraction"
import { insertSourceCandidates, insertSourceSnapshot } from "@/lib/sources/persistence"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { getStoredIntegrationToken } from "@/lib/supabase/integration-tokens"
import { sourceIntakeResponseSchema } from "@/schemas/sources"
import type { SourceIntakeResponse } from "@/schemas/sources"

interface NotionSearchResult {
  id?: string
  object?: string
  url?: string
  archived?: boolean
  properties?: Record<string, unknown>
  title?: Array<{ plain_text?: string }>
}

interface NotionSearchResponse {
  results?: NotionSearchResult[]
  error?: string
  message?: string
}

function extractPlainText(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return []
  }

  if (Array.isArray(value)) {
    return value.flatMap(extractPlainText)
  }

  const record = value as Record<string, unknown>
  const plainText = typeof record.plain_text === "string" ? [record.plain_text] : []

  return [
    ...plainText,
    ...Object.values(record).flatMap((item) => {
      if (!item || typeof item !== "object") {
        return []
      }

      return extractPlainText(item)
    }),
  ]
}

function renderNotionResult(result: NotionSearchResult, index: number) {
  const propertyText = extractPlainText(result.properties).join(" | ").slice(0, 4000)
  const title = extractPlainText(result.title).join(" ").trim()

  return [
    `Result ${index + 1}`,
    `Object: ${result.object ?? "unknown"}`,
    `ID: ${result.id ?? "unknown"}`,
    title ? `Title: ${title}` : null,
    result.url ? `URL: ${result.url}` : null,
    propertyText ? `Properties: ${propertyText}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n")
}

export async function POST(request: Request) {
  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const body = await request.json().catch(() => ({})) as { query?: string }
    const query = body.query?.trim() || "deadline due assignment syllabus exam project task"
    const token = await getStoredIntegrationToken(user.id, "notion")

    if (!token?.access_token) {
      return NextResponse.json(
        {
          error: "Notion is not connected.",
          needsAuthorization: true,
        },
        { status: 409 },
      )
    }

    const response = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify({
        query,
        page_size: 20,
        sort: {
          direction: "descending",
          timestamp: "last_edited_time",
        },
      }),
      cache: "no-store",
    })
    const payload = (await response.json().catch(() => null)) as NotionSearchResponse | null

    if (!response.ok || !payload) {
      throw new Error(payload?.message || payload?.error || `Notion import failed with status ${response.status}.`)
    }

    const results = payload.results || []

    if (results.length === 0) {
      const sourceSnapshot = await insertSourceSnapshot({
        adminClient,
        userId: user.id,
        source: "notion",
        sourceRef: query,
        freshness: "fresh",
        summary: "Notion import completed; no pages matched the scheduling query.",
        payload: {
          query,
          resultCount: 0,
        },
      })
      const responsePayload: SourceIntakeResponse = {
        success: true,
        sourceSnapshot,
        sourceFile: null,
        candidates: [],
      }

      return NextResponse.json(sourceIntakeResponseSchema.parse(responsePayload))
    }

    const sourceText = results.map(renderNotionResult).join("\n\n---\n\n")
    const extraction = await extractCandidatesFromText({
      source: "notion",
      sourceRef: query,
      label: "Notion scheduling import",
      text: sourceText,
    })
    const sourceSnapshot = await insertSourceSnapshot({
      adminClient,
      userId: user.id,
      source: "notion",
      sourceRef: query,
      freshness: "partial",
      summary: extraction.summary,
      payload: {
        query,
        resultCount: results.length,
        resultIds: results.map((result) => result.id).filter(Boolean),
        model: extraction.model,
        candidateCount: extraction.candidates.length,
      },
    })
    const candidates = await insertSourceCandidates({
      adminClient,
      userId: user.id,
      sourceSnapshotId: sourceSnapshot.id,
      candidates: extraction.candidates,
    })

    await adminClient
      .from("integrations")
      .update({
        status: "connected",
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id)
      .eq("provider", "notion")

    const responsePayload: SourceIntakeResponse = {
      success: true,
      sourceSnapshot,
      sourceFile: null,
      candidates,
    }

    return NextResponse.json(sourceIntakeResponseSchema.parse(responsePayload))
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to import Notion context.",
        details: error instanceof Error ? error.message : "Unknown Notion import error.",
      },
      { status: 500 },
    )
  }
}
