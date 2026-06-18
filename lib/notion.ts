export const NOTION_API_VERSION = "2022-06-28"

export interface NotionApiErrorPayload {
  error?: string
  message?: string
}

export type NotionRichTextItem = {
  plain_text?: string
}

export type NotionPropertyValue = {
  id?: string
  type?: string
  title?: NotionRichTextItem[]
  rich_text?: NotionRichTextItem[]
  date?: { start?: string | null; end?: string | null; time_zone?: string | null } | null
  status?: { name?: string | null } | null
  select?: { name?: string | null } | null
  multi_select?: Array<{ name?: string | null }>
  relation?: Array<{ id?: string | null }>
  checkbox?: boolean
  number?: number | null
  url?: string | null
  email?: string | null
  phone_number?: string | null
  formula?: {
    type?: string
    string?: string | null
    number?: number | null
    boolean?: boolean | null
    date?: { start?: string | null; end?: string | null } | null
  } | null
  created_time?: string
  last_edited_time?: string
  [key: string]: unknown
}

export interface NotionPageResult {
  id?: string
  object?: string
  url?: string
  archived?: boolean
  properties?: Record<string, NotionPropertyValue>
  title?: NotionRichTextItem[]
}

export interface NotionDatabaseResult {
  id?: string
  object?: string
  url?: string
  archived?: boolean
  title?: NotionRichTextItem[]
}

export interface NotionSearchResponse {
  results?: NotionDatabaseResult[]
  error?: string
  message?: string
}

export interface NotionDatabaseQueryResponse {
  results?: NotionPageResult[]
  has_more?: boolean
  next_cursor?: string | null
  error?: string
  message?: string
}

export async function fetchNotionJson<T>(
  accessToken: string,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_API_VERSION,
      ...init?.headers,
    },
    cache: "no-store",
  })
  const payload = (await response.json().catch(() => null)) as (T & NotionApiErrorPayload) | null

  if (!response.ok || !payload) {
    const message = payload?.message || payload?.error || `Notion API failed with status ${response.status}.`

    if (response.status === 401 || response.status === 403) {
      throw new Error(`NOTION_REAUTH_REQUIRED: ${message} Reconnect Notion so JARVIS can read shared pages.`)
    }

    if (response.status === 404) {
      throw new Error(`NOTION_DATABASE_NOT_FOUND: ${message}`)
    }

    throw new Error(message)
  }

  return payload
}

function hyphenateNotionId(id: string) {
  const normalized = id.replace(/-/g, "").toLowerCase()

  if (!/^[0-9a-f]{32}$/.test(normalized)) {
    return null
  }

  return [
    normalized.slice(0, 8),
    normalized.slice(8, 12),
    normalized.slice(12, 16),
    normalized.slice(16, 20),
    normalized.slice(20),
  ].join("-")
}

export function extractNotionId(input: string) {
  const trimmed = input.trim()

  if (!trimmed) {
    return null
  }

  const direct = hyphenateNotionId(trimmed)

  if (direct) {
    return direct
  }

  try {
    const url = new URL(trimmed)
    const pathMatch = url.pathname.match(/[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/)
    const pathId = pathMatch ? hyphenateNotionId(pathMatch[0]) : null

    if (pathId) {
      return pathId
    }
  } catch {
    // Fall through to searching arbitrary pasted text.
  }

  const match = trimmed.match(/[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/)
  return match ? hyphenateNotionId(match[0]) : null
}

export function extractNotionPlainText(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return []
  }

  if (Array.isArray(value)) {
    return value.flatMap(extractNotionPlainText)
  }

  const record = value as Record<string, unknown>
  const plainText = typeof record.plain_text === "string" ? [record.plain_text] : []

  return [
    ...plainText,
    ...Object.values(record).flatMap((item) => {
      if (!item || typeof item !== "object") {
        return []
      }

      return extractNotionPlainText(item)
    }),
  ]
}

export function getNotionTitle(value: unknown) {
  return extractNotionPlainText(value).join(" ").replace(/\s+/g, " ").trim() || null
}
