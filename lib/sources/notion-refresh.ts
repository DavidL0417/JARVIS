import {
  fetchNotionJson,
  getNotionTitle,
  type NotionDatabaseQueryResponse,
  type NotionPageResult,
  type NotionPropertyValue,
} from "@/lib/notion"
import { insertSourceSnapshot } from "@/lib/sources/persistence"
import { getStoredIntegrationToken } from "@/lib/supabase/integration-tokens"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { TASKS_CALENDAR_ID } from "@/lib/task-calendar-constants"
import type { ExtractedSourceCandidate } from "@/lib/sources/extraction"
import type { Priority } from "@/types"
import type { SourceIntakeResponse } from "@/schemas/sources"

// Safety ceiling on a full pull (open + completed rows). High enough to cover a
// real Tasks DB in one sync so the pull stays `complete` (see queryNotionDatabase).
const MAX_NOTION_DATABASE_PAGES = 1000

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

function parseDueAt(page: NotionPageResult): { dueAt: string | null; allDay: boolean } {
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
  const startValue = fallbackDateProperty?.date?.start ?? null
  const endValue = fallbackDateProperty?.date?.end ?? null

  if (!startValue) {
    return { dueAt: null, allDay: false }
  }

  // A ranged Due Date (start..end) means the work is due by the END of the range,
  // not the day it opens. Use the end when present so a multi-day assignment lands
  // on its real deadline.
  const dueValue = endValue ?? startValue
  const parsed = new Date(dueValue)
  if (Number.isNaN(parsed.getTime())) {
    return { dueAt: null, allDay: false }
  }

  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dueValue.trim())
  const isMultiDay = Boolean(endValue && endValue !== startValue)
  return {
    dueAt: parsed.toISOString(),
    allDay: isDateOnly || isMultiDay,
  }
}

// The course property is often a *relation* to a Courses database, not text — so
// `propertyText` alone returns null (it has no relation case), which is why course
// chips were missing. When it's a relation we map each related page id to its
// resolved title via `courseLabels` (built once per sync by resolveCourseLabels);
// otherwise we read it as text/select.
function parseCourse(page: NotionPageResult, courseLabels?: Map<string, string>): string | null {
  const property = findProperty(
    page.properties || {},
    (name) => /(course|class|subject|project)/i.test(name),
  )
  if (!property) {
    return null
  }
  if (property.type === "relation") {
    if (!courseLabels) {
      return null
    }
    const labels = (property.relation || [])
      .map((entry) => (entry?.id ? courseLabels.get(entry.id) : null))
      .filter((label): label is string => Boolean(label))
    return labels.length > 0 ? normalizeText([...new Set(labels)].join(", ")) : null
  }
  return propertyText(property)
}

// The kind of work, from the Notion Category/Type select (e.g. "Problem Set",
// "Reading", "Application"). `propertyText` already flattens select/multi_select.
function parseCategory(page: NotionPageResult): string | null {
  const property = findProperty(
    page.properties || {},
    (name) => /(category|type|kind)/i.test(name),
  )
  return propertyText(property ?? undefined)
}

// Course is frequently a relation whose value is just a page id; the human label
// ("MATH 240 — Linear Algebra") lives on the related page. Collect the related
// course-page ids referenced by a page.
function courseRelationIds(page: NotionPageResult): string[] {
  const property = findProperty(
    page.properties || {},
    (name) => /(course|class|subject|project)/i.test(name),
  )
  if (!property || property.type !== "relation") {
    return []
  }
  return (property.relation || [])
    .map((entry) => entry?.id ?? null)
    .filter((id): id is string => Boolean(id))
}

// Resolve every referenced course page id to its title in one batched pass per
// sync (a handful of courses), so the per-page parseCourse is a cheap map lookup.
async function resolveCourseLabels(
  accessToken: string,
  pages: NotionPageResult[],
): Promise<Map<string, string>> {
  const ids = new Set<string>()
  for (const page of pages) {
    for (const id of courseRelationIds(page)) {
      ids.add(id)
    }
  }
  const labels = new Map<string, string>()
  await Promise.all(
    [...ids].map(async (id) => {
      try {
        const related = await fetchNotionJson<NotionPageResult>(
          accessToken,
          `https://api.notion.com/v1/pages/${encodeURIComponent(id)}`,
        )
        const title = getPageTitle(related)
        if (title) {
          labels.set(id, title)
        }
      } catch {
        // A course page we can't read (unshared/deleted) just yields no label; the
        // task still imports, just without a course chip.
      }
    }),
  )
  return labels
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

// Pull the whole Tasks DB (open AND completed rows). `complete` is true only when
// we exhausted the cursor rather than hitting the page cap — completion + deletion
// reconciliation rely on a COMPLETE pull, since "page absent from the pull" must
// mean "gone from Notion", not "beyond the cap".
async function queryNotionDatabase(
  accessToken: string,
  databaseId: string,
): Promise<{ pages: NotionPageResult[]; complete: boolean }> {
  const pages: NotionPageResult[] = []
  let cursor: string | null = null
  let complete = true

  do {
    const payload: NotionDatabaseQueryResponse = await fetchNotionJson<NotionDatabaseQueryResponse>(
      accessToken,
      `https://api.notion.com/v1/databases/${encodeURIComponent(databaseId)}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          page_size: 100,
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
    if (payload.has_more) {
      if (pages.length >= MAX_NOTION_DATABASE_PAGES) {
        complete = false
        cursor = null
      } else {
        cursor = payload.next_cursor ?? null
      }
    } else {
      cursor = null
    }
  } while (cursor)

  return { pages, complete }
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

    // Skip Notion structural artifacts that get pulled in when a Canvas page is
    // mirrored into Notion (block-type sub-pages like "• Attachment", "• Page",
    // "• External Url"). They are never real tasks.
    if (/^[••]\s/.test(title)) {
      continue
    }

    const { dueAt, allDay } = parseDueAt(page)
    const durationMinutes = parseDurationMinutes(page)
    const properties = renderPageProperties(page)
    const sourceLabel = databaseName || "Notion tasks database"
    const multiDayByDuration = (durationMinutes ?? 0) >= 1440

    candidates.push({
      kind: dueAt ? "deadline" : "task",
      title,
      description: properties || null,
      course: parseCourse(page),
      dueAt,
      durationMinutes,
      priority: parsePriority(page),
      confidence: dueAt ? 0.95 : 0.75,
      evidence: `${sourceLabel}${page.url ? ` (${page.url})` : ""}`,
      allDay: allDay || multiDayByDuration,
      // Link back to the Notion page so the approved task carries it as
      // external_task_id — the join key for completion sync in both directions.
      externalId: page.id ?? null,
      externalSource: "notion",
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

// Notion is the source of truth for completion AND existence. On each sync: a page
// completed/archived in Notion marks its linked JARVIS task done; a page that is
// gone entirely (deleted/archived out of the DB) has its open task removed — but
// only when the pull was COMPLETE, so a capped pull never mistakes "beyond the
// cap" for "deleted". Still-pending Notion candidates whose page is no longer open
// are dismissed so the backlog drains.
async function applyNotionCompletionSync(
  adminClient: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  pages: NotionPageResult[],
  complete: boolean,
): Promise<{ completedTaskCount: number; prunedCandidateCount: number; removedTaskCount: number }> {
  const nowIso = new Date().toISOString()
  const completedPageIds = pages
    .filter((page) => page.id && (isCompletedPage(page) || page.archived))
    .map((page) => page.id as string)
  const openPageIds = new Set(
    pages.filter((page) => page.id && !isCompletedPage(page) && !page.archived).map((page) => page.id as string),
  )
  const allPageIds = new Set(pages.filter((page) => page.id).map((page) => page.id as string))

  let completedTaskCount = 0
  if (completedPageIds.length > 0) {
    const { data: doneRows } = await adminClient
      .from("tasks")
      .update({ status: "completed", scheduled_for: null, updated_at: nowIso })
      .eq("user_id", userId)
      .in("external_task_id", completedPageIds)
      .neq("status", "completed")
      .select("id")
    completedTaskCount = (doneRows ?? []).length
  }

  // Remove open tasks whose Notion page no longer exists (deleted/archived out of
  // the DB). Guarded by a complete pull so a truncated sync can't wrongly delete.
  // Completed tasks are kept as history; only un-finished orphans are cleared.
  let removedTaskCount = 0
  if (complete) {
    const { data: notionTasks } = await adminClient
      .from("tasks")
      .select("id, external_task_id")
      .eq("user_id", userId)
      .eq("last_synced_from", "notion")
      .neq("status", "completed")
    const goneIds = (notionTasks ?? [])
      .filter((row) => {
        const ext = row.external_task_id as string | null
        return typeof ext === "string" && !allPageIds.has(ext)
      })
      .map((row) => row.id as string)
    if (goneIds.length > 0) {
      await adminClient.from("schedule_events").delete().eq("user_id", userId).in("task_id", goneIds)
      await adminClient.from("tasks").delete().eq("user_id", userId).in("id", goneIds)
      removedTaskCount = goneIds.length
    }
  }

  // Dismiss pending candidates whose Notion page is no longer an open row. Scoped
  // to candidates that carry a Notion page link, so non-Notion candidates are
  // never touched.
  const { data: pendingRows } = await adminClient
    .from("source_candidates")
    .select("id, payload")
    .eq("user_id", userId)
    .eq("status", "pending")
  const staleIds = (pendingRows ?? [])
    .filter((row) => {
      const ext = (row.payload as Record<string, unknown> | null)?.externalId
      return typeof ext === "string" && !openPageIds.has(ext)
    })
    .map((row) => row.id as string)
  let prunedCandidateCount = 0
  if (staleIds.length > 0) {
    await adminClient.from("source_candidates").update({ status: "dismissed", updated_at: nowIso }).in("id", staleIds)
    prunedCandidateCount = staleIds.length
  }

  return { completedTaskCount, prunedCandidateCount, removedTaskCount }
}

/**
 * Mirror the OPEN rows of the Notion Tasks DB into JARVIS tasks 1:1, keyed by the
 * Notion page id (`external_task_id`). The page is the identity: two rows with the
 * same title stay two tasks, a row whose title/date changed is refreshed in place,
 * and an open row with no task gets one created (which is how a row JARVIS lost
 * track of comes back). Completed/archived pages were already reconciled by
 * applyNotionCompletionSync, so they are skipped here. Notion only ever yields
 * task/deadline rows (never events), so everything lands in the tasks table.
 */
async function mirrorOpenNotionPagesToTasks(
  adminClient: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  pages: NotionPageResult[],
  courseLabels: Map<string, string>,
): Promise<{ created: number; updated: number }> {
  const nowIso = new Date().toISOString()
  let created = 0
  let updated = 0

  for (const page of pages) {
    if (!page.id || page.archived) {
      continue
    }

    const title = getPageTitle(page)
    // Skip empty titles and Notion block-type artifacts ("• Attachment", etc.).
    if (!title || /^[••]\s/.test(title)) {
      continue
    }

    // Facets are refreshed for every row — including finished ones, so a course
    // that was a relation (and previously dropped) backfills onto old tasks.
    const completed = isCompletedPage(page)
    const course = parseCourse(page, courseLabels)
    const category = parseCategory(page)

    const { data: existing } = await adminClient
      .from("tasks")
      .select("id, status, course, category")
      .eq("user_id", userId)
      .eq("external_task_id", page.id)
      .maybeSingle<{ id: string; status: string; course: string | null; category: string | null }>()

    if (existing) {
      const facetsChanged =
        (existing.course ?? null) !== (course ?? null) || (existing.category ?? null) !== (category ?? null)
      // A finished task is never reopened or re-dated — only its facets are
      // backfilled, and only when they actually changed (no churn each sync).
      if (existing.status === "completed" || completed) {
        if (facetsChanged) {
          await adminClient
            .from("tasks")
            .update({ course, category, updated_at: nowIso })
            .eq("id", existing.id)
            .eq("user_id", userId)
          updated += 1
        }
        continue
      }

      // Open row: Notion is source of truth for content; refresh it and the facets.
      const { dueAt, allDay } = parseDueAt(page)
      const durationMinutes = parseDurationMinutes(page)
      const allDayFinal = allDay || (durationMinutes ?? 0) >= 1440
      const priority = parsePriority(page)
      await adminClient
        .from("tasks")
        .update({ title, deadline: dueAt, all_day: allDayFinal, priority, course, category, updated_at: nowIso })
        .eq("id", existing.id)
        .eq("user_id", userId)
      updated += 1
      continue
    }

    // No task yet. A completed page is never resurrected as a fresh todo — the
    // completion sync owns finished rows; only open pages seed new tasks.
    if (completed) {
      continue
    }

    const { dueAt, allDay } = parseDueAt(page)
    const durationMinutes = parseDurationMinutes(page)
    const allDayFinal = allDay || (durationMinutes ?? 0) >= 1440
    const priority = parsePriority(page)
    await adminClient.from("tasks").insert({
      user_id: userId,
      title,
      description: renderPageProperties(page) || null,
      deadline: dueAt,
      duration_minutes: durationMinutes,
      priority,
      status: "todo",
      scheduled_for: null,
      is_immutable: false,
      all_day: allDayFinal,
      calendar_id: TASKS_CALENDAR_ID,
      tags: [],
      course,
      category,
      source_snapshot_id: null,
      source_candidate_id: null,
      plan_id: null,
      external_task_id: page.id,
      last_synced_from: "notion",
    })
    created += 1
  }

  return { created, updated }
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
  const { pages, complete } = await queryNotionDatabase(token.access_token, databaseId)
  // 1:1 mirror: reconcile completion/removal first, then upsert the open rows as
  // tasks keyed by Notion page id. No candidate/approve step — the Notion Tasks DB
  // is authoritative, so every open row IS a task (dated or not, never deduped by
  // content).
  const completionSync = await applyNotionCompletionSync(adminClient, userId, pages, complete)
  // Resolve course relations → labels once per sync; the mirror then reads them
  // as cheap map lookups instead of an API call per page.
  const courseLabels = await resolveCourseLabels(token.access_token, pages)
  const mirror = await mirrorOpenNotionPagesToTasks(adminClient, userId, pages, courseLabels)
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
      pullComplete: complete,
      openRowCount: extractedCandidates.length,
      tasksCreated: mirror.created,
      tasksUpdated: mirror.updated,
      completedTaskCount: completionSync.completedTaskCount,
      prunedCandidateCount: completionSync.prunedCandidateCount,
      removedTaskCount: completionSync.removedTaskCount,
    },
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
    candidates: [],
  }
}
