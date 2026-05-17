export interface CanvasUserProfile {
  id?: number | string
  name?: string
  short_name?: string
  sortable_name?: string
  primary_email?: string
  login_id?: string
}

export interface CanvasPlannerOverride {
  id?: number | string
  marked_complete?: boolean
  dismissed?: boolean
}

export interface CanvasPlannerItem {
  context_name?: string
  course_id?: number | string
  html_url?: string
  plannable_id?: number | string
  plannable_type?: string
  planner_override?: CanvasPlannerOverride | null
  submissions?: { submitted?: boolean; submitted_at?: string | null } | null
  plannable?: {
    id?: number | string
    title?: string
    name?: string
    due_at?: string | null
    todo_date?: string | null
    html_url?: string | null
    points_possible?: number | null
  } | null
  date?: string | null
  plannable_date?: string | null
}

export class CanvasApiError extends Error {
  status: number
  reauthorizationRequired: boolean

  constructor(message: string, status: number, reauthorizationRequired = false) {
    super(message)
    this.name = "CanvasApiError"
    this.status = status
    this.reauthorizationRequired = reauthorizationRequired
  }
}

export function normalizeCanvasBaseUrl(value: string) {
  const trimmed = value.trim()

  if (!trimmed) {
    throw new Error("Canvas base URL is required.")
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const url = new URL(withProtocol)

  if (url.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw new Error("Canvas base URL must use HTTPS.")
  }

  url.pathname = ""
  url.search = ""
  url.hash = ""
  return url.toString().replace(/\/$/, "")
}

function canvasApiUrl(baseUrl: string, path: string, params?: Record<string, string | string[] | undefined>) {
  const url = new URL(path, `${baseUrl}/`)

  for (const [key, value] of Object.entries(params ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, item)
      }
    } else if (value) {
      url.searchParams.set(key, value)
    }
  }

  return url
}

function parseCanvasError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>
    if (typeof record.message === "string") return record.message
    if (typeof record.error === "string") return record.error
    if (Array.isArray(record.errors)) {
      const messages = record.errors
        .map((error) => {
          if (typeof error === "string") return error
          if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
            return (error as { message: string }).message
          }
          return null
        })
        .filter((message): message is string => Boolean(message))

      if (messages.length > 0) return messages.join("; ")
    }
  }

  return fallback
}

async function canvasFetch<T>(input: {
  baseUrl: string
  accessToken: string
  path: string
  params?: Record<string, string | string[] | undefined>
  init?: RequestInit
}): Promise<{ data: T; response: Response }> {
  const response = await fetch(canvasApiUrl(input.baseUrl, input.path, input.params), {
    ...input.init,
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
      ...(input.init?.headers ?? {}),
    },
    cache: "no-store",
  })
  const payload = (await response.json().catch(() => null)) as T | null

  if (!response.ok || payload === null) {
    const message = parseCanvasError(payload, `Canvas API failed with status ${response.status}.`)
    throw new CanvasApiError(
      message,
      response.status,
      response.status === 401 || response.status === 403,
    )
  }

  return { data: payload, response }
}

function nextLink(response: Response) {
  const link = response.headers.get("link")

  if (!link) {
    return null
  }

  const next = link
    .split(",")
    .map((part) => part.trim())
    .find((part) => /rel="?next"?/i.test(part))
  const match = next?.match(/<([^>]+)>/)

  return match?.[1] ?? null
}

export async function fetchCanvasJson<T>(input: {
  baseUrl: string
  accessToken: string
  path: string
  params?: Record<string, string | string[] | undefined>
  init?: RequestInit
}) {
  return (await canvasFetch<T>(input)).data
}

export async function fetchCanvasPaginated<T>(input: {
  baseUrl: string
  accessToken: string
  path: string
  params?: Record<string, string | string[] | undefined>
  maxPages?: number
}) {
  const results: T[] = []
  let pathOrUrl: string | null = input.path
  let params = input.params
  let pages = 0

  while (pathOrUrl && pages < (input.maxPages ?? 10)) {
    const isAbsolute = /^https?:\/\//i.test(pathOrUrl)
    const { data, response } = await canvasFetch<T[]>({
      baseUrl: input.baseUrl,
      accessToken: input.accessToken,
      path: isAbsolute ? pathOrUrl : pathOrUrl,
      params: isAbsolute ? undefined : params,
    })

    results.push(...data)
    pathOrUrl = nextLink(response)
    params = undefined
    pages += 1
  }

  return results
}

export async function validateCanvasConnection(input: {
  baseUrl: string
  accessToken: string
}) {
  return fetchCanvasJson<CanvasUserProfile>({
    baseUrl: input.baseUrl,
    accessToken: input.accessToken,
    path: "/api/v1/users/self/profile",
  })
}

export async function createCanvasPlannerOverride(input: {
  baseUrl: string
  accessToken: string
  plannableType: string
  plannableId: string
  markedComplete: boolean
}) {
  return fetchCanvasJson<CanvasPlannerOverride>({
    baseUrl: input.baseUrl,
    accessToken: input.accessToken,
    path: "/api/v1/planner/overrides",
    init: {
      method: "POST",
      body: JSON.stringify({
        plannable_type: input.plannableType,
        plannable_id: input.plannableId,
        marked_complete: input.markedComplete,
      }),
    },
  })
}

export async function updateCanvasPlannerOverride(input: {
  baseUrl: string
  accessToken: string
  overrideId: string
  markedComplete: boolean
}) {
  return fetchCanvasJson<CanvasPlannerOverride>({
    baseUrl: input.baseUrl,
    accessToken: input.accessToken,
    path: `/api/v1/planner/overrides/${encodeURIComponent(input.overrideId)}`,
    init: {
      method: "PUT",
      body: JSON.stringify({
        marked_complete: input.markedComplete,
      }),
    },
  })
}
