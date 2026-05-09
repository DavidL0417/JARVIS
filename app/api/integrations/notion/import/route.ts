import { NextResponse } from "next/server"

import {
  fetchNotionJson,
  getNotionTitle,
  type NotionDatabaseQueryResponse,
  type NotionPageResult,
  type NotionPropertyValue,
} from "@/lib/notion"
import { insertSourceCandidates, insertSourceSnapshot } from "@/lib/sources/persistence"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { getStoredIntegrationToken } from "@/lib/supabase/integration-tokens"
import { sourceIntakeResponseSchema } from "@/schemas/sources"
import type { SourceIntakeResponse } from "@/schemas/sources"
import type { ExtractedSourceCandidate } from "@/lib/sources/extraction"
import type { Priority } from "@/types"

const MAX_NOTION_DATABASE_PAGES = 200

function isMissingSelectedSourceColumn(error: { message?: string; code?: string } | null) {
  return Boolean(
    error &&
      (error.code === "42703" ||
        /selected_source_id|selected_source_name|does not exist/i.test(error.message ?? "")),
  )
}

function normalizeText(value: string | null | undefined) {
  const trimmed = value?.replace(/\s+/g, " ").trim()
  return trimmed ? trimmed : null
}

function propertyText(property: NotionPropertyValue | undefined): string | null {
  if (!property) {
    return null
  }

  switch (property.type) {
    case "title":
      return normalizeText(getNotionTitle(property.title))
    case "rich_text":
      return normalizeText(getNotionTitle(property.rich_text))
    case "date":
      return normalizeText(property.date?.start ?? null)
    case "status":
      return normalizeText(property.status?.name ?? null)
    case "select":
      return normalizeText(property.select?.name ?? null)
    case "multi_select":
      return normalizeText((property.multi_select || []).map((item) => item.name).filter(Boolean).join(", "))
    case "checkbox":
      return property.checkbox ? "Yes" : "No"
    case "number":
      return typeof property.number === "number" ? String(property.number) : null
    case "url":
      return normalizeText(property.url ?? null)
    case "email":
      return normalizeText(property.email ?? null)
    case "phone_number":
      return normalizeText(property.phone_number ?? null)
    case "created_time":
      return normalizeText(property.created_time)
    case "last_edited_time":
      return normalizeText(property.last_edited_time)
    case "formula":
      if (!property.formula) {
        return null
      }

      if (property.formula.type === "string") {
        return normalizeText(property.formula.string)
      }

      if (property.formula.type === "number") {
        return typeof property.formula.number === "number" ? String(property.formula.number) : null
      }

      if (property.formula.type === "boolean") {
        return typeof property.formula.boolean === "boolean" ? (property.formula.boolean ? "Yes" : "No") : null
      }

      if (property.formula.type === "date") {
        return normalizeText(property.formula.date?.start ?? null)
      }

      return null
    default:
      return null
  }
}

function getPageTitle(page: NotionPageResult) {
  const properties = page.properties || {}
  const titleProperty = Object.values(properties).find((property) => property.type === "title")

  return propertyText(titleProperty) || getNotionTitle(page.title) || null
}

function findProperty(
  properties: Record<string, NotionPropertyValue>,
  predicate: (name: string, property: NotionPropertyValue) => boolean,
) {
  return Object.entries(properties).find(([name, property]) => predicate(name, property))?.[1] ?? null
}

function parseDueAt(page: NotionPageResult) {
  const properties = page.properties || {}
  const namedDateProperty = findProperty(
    properties,
    (name, property) =>
      property.type === "date" &&
      /(due|deadline|date|when)/i.test(name) &&
      !/(created|edited|completed|done)/i.test(name),
  )
  const fallbackDateProperty =
    namedDateProperty ||
    Object.values(properties).find((property) => property.type === "date") ||
    null
  const value = fallbackDateProperty?.date?.start ?? null

  if (!value) {
    return null
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function parseCourse(page: NotionPageResult) {
  const property = findProperty(
    page.properties || {},
    (name) => /(course|class|subject|project)/i.test(name),
  )

  return propertyText(property ?? undefined)
}

function parseDurationMinutes(page: NotionPageResult) {
  const property = findProperty(
    page.properties || {},
    (name, value) => value.type === "number" && /(duration|estimate|minutes|mins|time)/i.test(name),
  )

  if (!property || typeof property.number !== "number") {
    return null
  }

  return Math.max(Math.round(property.number), 1)
}

function parsePriority(page: NotionPageResult): Priority {
  const property = findProperty(
    page.properties || {},
    (name) => /(priority|importance|urgency)/i.test(name),
  )
  const value = propertyText(property ?? undefined)?.toLowerCase() ?? ""

  if (/(high|urgent|critical|p0|p1)/i.test(value)) {
    return "high"
  }

  if (/(low|someday|p3|p4)/i.test(value)) {
    return "low"
  }

  return "medium"
}

function isCompletedPage(page: NotionPageResult) {
  for (const [name, property] of Object.entries(page.properties || {})) {
    const propertyName = name.toLowerCase()
    const value = propertyText(property)?.toLowerCase() ?? ""

    if (property.type === "checkbox" && /(done|complete|completed|finished)/i.test(propertyName) && property.checkbox) {
      return true
    }

    if (/(status|done|complete|completed|state)/i.test(propertyName)) {
      if (/(done|complete|completed|finished|submitted|turned in|archived|canceled|cancelled)/i.test(value)) {
        return true
      }
    }
  }

  return Boolean(page.archived)
}

function renderPageProperties(page: NotionPageResult) {
  return Object.entries(page.properties || {})
    .map(([name, property]) => {
      const value = propertyText(property)
      return value ? `${name}: ${value}` : null
    })
    .filter((line): line is string => Boolean(line))
    .join("; ")
}

async function queryNotionDatabase(accessToken: string, databaseId: string) {
  const pages: NotionPageResult[] = []
  let cursor: string | null = null

  do {
    const payload: NotionDatabaseQueryResponse = await fetchNotionJson<NotionDatabaseQueryResponse>(
      accessToken,
      `https://api.notion.com/v1/databases/${encodeURIComponent(databaseId)}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          page_size: 50,
          start_cursor: cursor ?? undefined,
          sorts: [
            {
              timestamp: "last_edited_time",
              direction: "descending",
            },
          ],
        }),
      },
    )

    pages.push(...(payload.results || []))
    cursor = payload.has_more && pages.length < MAX_NOTION_DATABASE_PAGES ? payload.next_cursor ?? null : null
  } while (cursor)

  return pages
}

function pagesToCandidates(pages: NotionPageResult[], databaseName: string | null): ExtractedSourceCandidate[] {
  const candidates: ExtractedSourceCandidate[] = []

  for (const page of pages) {
    if (isCompletedPage(page)) {
      continue
    }

    const title = getPageTitle(page)

    if (!title) {
      continue
    }

    const dueAt = parseDueAt(page)
    const properties = renderPageProperties(page)
    const sourceLabel = databaseName || "Notion tasks database"

    candidates.push({
      kind: dueAt ? "deadline" : "task",
      title,
      description: properties || null,
      course: parseCourse(page),
      dueAt,
      durationMinutes: parseDurationMinutes(page),
      priority: parsePriority(page),
      confidence: dueAt ? 0.95 : 0.75,
      evidence: `${sourceLabel}${page.url ? ` (${page.url})` : ""}`,
    })
  }

  return candidates
}

function buildSummary(candidates: ExtractedSourceCandidate[], pages: NotionPageResult[], databaseName: string | null) {
  const dueCount = candidates.filter((candidate) => candidate.dueAt).length
  const noDateCount = candidates.length - dueCount
  const completedCount = pages.filter(isCompletedPage).length
  const label = databaseName || "Notion tasks database"

  if (pages.length === 0) {
    return `${label} import completed; no task rows were returned.`
  }

  if (candidates.length === 0) {
    return `${label} import completed; ${completedCount} rows appear complete and no open tasks were found.`
  }

  return `${label} import found ${candidates.length} open task${candidates.length === 1 ? "" : "s"}: ${dueCount} with due dates, ${noDateCount} needing dates.`
}

export async function POST() {
  let userId: string | null = null

  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    userId = user.id
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

    const { data: integration, error: integrationError } = await adminClient
      .from("integrations")
      .select("selected_source_id, selected_source_name")
      .eq("user_id", user.id)
      .eq("provider", "notion")
      .maybeSingle<{ selected_source_id: string | null; selected_source_name: string | null }>()

    if (integrationError) {
      if (isMissingSelectedSourceColumn(integrationError)) {
        return NextResponse.json(
          {
            error: "The Notion tasks database migration has not been applied yet. Apply the pending Supabase migration, then choose the authoritative tasks database.",
            needsDatabaseSelection: true,
          },
          { status: 409 },
        )
      }

      throw new Error(integrationError.message)
    }

    const databaseId = integration?.selected_source_id

    if (!databaseId) {
      return NextResponse.json(
        {
          error: "Choose the authoritative Notion tasks database before importing.",
          needsDatabaseSelection: true,
        },
        { status: 409 },
      )
    }

    const databaseName = normalizeText(integration?.selected_source_name)
    const pages = await queryNotionDatabase(token.access_token, databaseId)
    const extractedCandidates = pagesToCandidates(pages, databaseName)
    const summary = buildSummary(extractedCandidates, pages, databaseName)
    const sourceSnapshot = await insertSourceSnapshot({
      adminClient,
      userId: user.id,
      source: "notion",
      sourceRef: databaseId,
      freshness: "fresh",
      summary,
      payload: {
        databaseId,
        databaseName,
        rowCount: pages.length,
        candidateCount: extractedCandidates.length,
      },
    })
    const candidates = await insertSourceCandidates({
      adminClient,
      userId: user.id,
      sourceSnapshotId: sourceSnapshot.id,
      candidates: extractedCandidates,
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
    const databaseNotFound = message.startsWith("NOTION_DATABASE_NOT_FOUND:")
    const detail = message
      .replace("NOTION_REAUTH_REQUIRED:", "")
      .replace("NOTION_DATABASE_NOT_FOUND:", "")
      .trim()

    if (userId && (databaseNotFound || needsAuthorization)) {
      try {
        const { adminClient } = await requireAuthenticatedUser()
        await insertSourceSnapshot({
          adminClient,
          userId,
          source: "notion",
          sourceRef: null,
          freshness: "failed",
          summary: databaseNotFound
            ? "The selected Notion tasks database could not be read. Share it with the Notion connection or choose a different database."
            : detail,
          payload: {
            reason: databaseNotFound ? "database_not_readable" : "reauthorization_required",
          },
        })
      } catch (recordError) {
        console.error("Failed to record Notion import failure state.", recordError)
      }
    }

    return NextResponse.json(
      {
        error: needsAuthorization
          ? detail
          : databaseNotFound
            ? "The selected Notion tasks database could not be read. Share it with the Notion connection or choose a different database."
            : "Failed to import Notion tasks database.",
        details: detail || message,
        needsAuthorization,
        needsDatabaseSelection: databaseNotFound,
      },
      { status: needsAuthorization || databaseNotFound ? 409 : 500 },
    )
  }
}
