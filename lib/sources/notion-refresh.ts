import {
  fetchNotionJson,
  getNotionTitle,
  type NotionDatabaseQueryResponse,
  type NotionPageResult,
  type NotionPropertyValue,
} from "@/lib/notion"
import { insertSourceCandidates, insertSourceSnapshot } from "@/lib/sources/persistence"
import { getStoredIntegrationToken } from "@/lib/supabase/integration-tokens"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import type { ExtractedSourceCandidate } from "@/lib/sources/extraction"
import type { Priority } from "@/types"
import type { SourceIntakeResponse } from "@/schemas/sources"

const MAX_NOTION_DATABASE_PAGES = 200

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

export async function refreshNotionForUser(userId: string): Promise<SourceIntakeResponse> {
  const adminClient = createSupabaseAdminClient()
  const token = await getStoredIntegrationToken(userId, "notion")

  if (!token?.access_token) {
    throw new Error("NOTION_REAUTH_REQUIRED: Notion is not connected.")
  }

  const { data: integration, error: integrationError } = await adminClient
    .from("integrations")
    .select("selected_source_id, selected_source_name")
    .eq("user_id", userId)
    .eq("provider", "notion")
    .maybeSingle<{ selected_source_id: string | null; selected_source_name: string | null }>()

  if (integrationError) {
    throw new Error(integrationError.message)
  }

  const databaseId = integration?.selected_source_id

  if (!databaseId) {
    throw new Error("NOTION_DATABASE_NOT_SELECTED: Choose the authoritative Notion tasks database before importing.")
  }

  const databaseName = normalizeText(integration?.selected_source_name)
  const pages = await queryNotionDatabase(token.access_token, databaseId)
  const extractedCandidates = pagesToCandidates(pages, databaseName)
  const summary = buildSummary(extractedCandidates, pages, databaseName)
  const sourceSnapshot = await insertSourceSnapshot({
    adminClient,
    userId,
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
    userId,
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
    .eq("user_id", userId)
    .eq("provider", "notion")

  return {
    success: true,
    sourceSnapshot,
    sourceFile: null,
    candidates,
  }
}
