import { NextResponse } from "next/server"
import { z } from "zod"

import { MEMORY_ITEM_SELECT, mapMemoryItemRowToDetail } from "@/lib/data/mappers"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { memoryImportanceSchema, memoryLayerSchema, memoryStatusSchema } from "@/schemas/common"
import type { MemoryItemRow, MemoryStatus } from "@/types"

// Lifecycle buckets surfaced as tabs in the workbench. Counts are per-status totals
// (the status filter is what the tabs select), independent of the other filters.
const COUNT_STATUSES: MemoryStatus[] = ["active", "archived", "superseded", "candidate", "stale"]

const listQuerySchema = z.object({
  status: z.union([memoryStatusSchema, z.literal("all")]).default("active"),
  layer: memoryLayerSchema.optional(),
  importance: memoryImportanceSchema.optional(),
  category: z.string().trim().min(1).max(120).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
})

const createMemorySchema = z.object({
  insight: z.string().trim().min(1, "Memory cannot be empty.").max(2000, "Memory is too long."),
  category: z.string().trim().min(1).max(120).optional(),
  importance: memoryImportanceSchema.optional(),
  layer: memoryLayerSchema.optional(),
  importanceNote: z.string().trim().min(1).max(500).nullable().optional(),
})

export async function GET(request: Request) {
  const rawParams = Object.fromEntries(new URL(request.url).searchParams)
  const parsedQuery = listQuerySchema.safeParse(rawParams)

  if (!parsedQuery.success) {
    return NextResponse.json(
      { error: "Invalid memory query", issues: parsedQuery.error.flatten() },
      { status: 400 },
    )
  }

  const { status, layer, importance, category, q, limit, offset } = parsedQuery.data

  try {
    const { adminClient, user } = await requireAuthenticatedUser()

    let query = adminClient.from("memory_items").select(MEMORY_ITEM_SELECT).eq("user_id", user.id)

    if (status !== "all") {
      query = query.eq("status", status)
    }
    if (layer) {
      query = query.eq("layer", layer)
    }
    if (importance) {
      query = query.eq("importance", importance)
    }
    if (category) {
      query = query.eq("category", category)
    }
    if (q) {
      // Escape ilike wildcards so a literal % or _ in the search text matches itself.
      const escaped = q.replace(/[\\%_]/g, (match) => `\\${match}`)
      query = query.ilike("content", `%${escaped}%`)
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      throw new Error(error.message)
    }

    const countResults = await Promise.all(
      COUNT_STATUSES.map((countStatus) =>
        adminClient
          .from("memory_items")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("status", countStatus),
      ),
    )

    const counts = COUNT_STATUSES.reduce<Record<MemoryStatus, number>>(
      (acc, countStatus, index) => {
        acc[countStatus] = countResults[index].count ?? 0
        return acc
      },
      { active: 0, archived: 0, superseded: 0, candidate: 0, stale: 0 },
    )

    return NextResponse.json({
      memories: (data || []).map((row) => mapMemoryItemRowToDetail(row as MemoryItemRow)),
      counts,
    })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to load memories.",
        details: error instanceof Error ? error.message : "Unknown memory list error.",
      },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsedBody = createMemorySchema.safeParse(body)

  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Invalid memory create request", issues: parsedBody.error.flatten() },
      { status: 400 },
    )
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()

    const { data, error } = await adminClient
      .from("memory_items")
      .insert({
        user_id: user.id,
        // A hand-authored note is a durable preference by default; kind/layer/source
        // are set server-side so the DB check constraints can never be violated.
        kind: "preference",
        layer: parsedBody.data.layer ?? "durable_preferences",
        category: parsedBody.data.category ?? "general",
        content: parsedBody.data.insight,
        importance: parsedBody.data.importance ?? "medium",
        importance_note: parsedBody.data.importanceNote ?? null,
        source_label: "manual",
        status: "active",
      })
      .select(MEMORY_ITEM_SELECT)
      .single<MemoryItemRow>()

    if (error) {
      throw new Error(error.message)
    }

    return NextResponse.json(
      { success: true, memory: mapMemoryItemRowToDetail(data) },
      { status: 201 },
    )
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to create memory.",
        details: error instanceof Error ? error.message : "Unknown memory create error.",
      },
      { status: 500 },
    )
  }
}
