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

interface NotionBlock {
  id?: string
  type?: string
  has_children?: boolean
  [key: string]: unknown
}

interface NotionBlockChildrenResponse {
  results?: NotionBlock[]
  has_more?: boolean
  next_cursor?: string | null
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

async function fetchNotionJson<T>(
  accessToken: string,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    cache: "no-store",
  })
  const payload = (await response.json().catch(() => null)) as (T & { error?: string; message?: string }) | null

  if (!response.ok || !payload) {
    const message = payload?.message || payload?.error || `Notion API failed with status ${response.status}.`

    if (response.status === 401 || response.status === 403) {
      throw new Error(`NOTION_REAUTH_REQUIRED: ${message} Reconnect Notion so JARVIS can read shared pages.`)
    }

    throw new Error(message)
  }

  return payload
}

function renderNotionBlock(block: NotionBlock) {
  const text = extractPlainText(block).join(" ").replace(/\s+/g, " ").trim()

  if (!text) {
    return null
  }

  return `${block.type ?? "block"}: ${text}`
}

async function fetchNotionBlockText(accessToken: string, blockId: string, depth = 0): Promise<string[]> {
  const lines: string[] = []
  let cursor: string | null = null
  let fetchedPages = 0

  do {
    const url = new URL(`https://api.notion.com/v1/blocks/${encodeURIComponent(blockId)}/children`)
    url.searchParams.set("page_size", "30")

    if (cursor) {
      url.searchParams.set("start_cursor", cursor)
    }

    const payload = await fetchNotionJson<NotionBlockChildrenResponse>(accessToken, url.toString())
    const blocks = payload.results || []

    for (const block of blocks) {
      const rendered = renderNotionBlock(block)

      if (rendered) {
        lines.push(rendered)
      }

      if (block.id && block.has_children && depth < 1) {
        const childLines = await fetchNotionBlockText(accessToken, block.id, depth + 1)
        lines.push(...childLines)
      }
    }

    cursor = payload.has_more ? payload.next_cursor ?? null : null
    fetchedPages += 1
  } while (cursor && fetchedPages < 2)

  return lines
}

async function renderNotionResult(accessToken: string, result: NotionSearchResult, index: number) {
  const propertyText = extractPlainText(result.properties).join(" | ").slice(0, 4000)
  const title = extractPlainText(result.title).join(" ").trim()
  const contentText =
    result.id && result.object === "page"
      ? (await fetchNotionBlockText(accessToken, result.id)).join("\n").slice(0, 8000)
      : ""

  return [
    `Result ${index + 1}`,
    `Object: ${result.object ?? "unknown"}`,
    `ID: ${result.id ?? "unknown"}`,
    title ? `Title: ${title}` : null,
    result.url ? `URL: ${result.url}` : null,
    propertyText ? `Properties: ${propertyText}` : null,
    contentText ? `Content:\n${contentText}` : null,
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

    const accessToken = token.access_token
    const payload = await fetchNotionJson<NotionSearchResponse>(accessToken, "https://api.notion.com/v1/search", {
      method: "POST",
      body: JSON.stringify({
        query,
        page_size: 12,
        sort: {
          direction: "descending",
          timestamp: "last_edited_time",
        },
      }),
    })
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

    const renderedResults = await Promise.all(results.map((result, index) => renderNotionResult(accessToken, result, index)))
    const sourceText = renderedResults.join("\n\n---\n\n")
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

    const message = error instanceof Error ? error.message : "Unknown Notion import error."
    const needsAuthorization = message.startsWith("NOTION_REAUTH_REQUIRED:")

    return NextResponse.json(
      {
        error: needsAuthorization
          ? message.replace("NOTION_REAUTH_REQUIRED:", "").trim()
          : "Failed to import Notion context.",
        details: message,
        needsAuthorization,
      },
      { status: needsAuthorization ? 409 : 500 },
    )
  }
}
