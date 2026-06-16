import { NextResponse } from "next/server"
import { z } from "zod"

import { MEMORY_ITEM_SELECT, mapMemoryItemRowToDetail } from "@/lib/data/mappers"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import type { MemoryItemRow } from "@/types"

const memoryIdSchema = z.string().uuid()

// Reactivates an archived or superseded memory. Restoring a superseded note leaves
// its supersedes_id back-reference intact (the newer note is unaffected).
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const parsedMemoryId = memoryIdSchema.safeParse(id)

  if (!parsedMemoryId.success) {
    return NextResponse.json({ error: "Invalid memory id." }, { status: 400 })
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()

    const { data, error } = await adminClient
      .from("memory_items")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", parsedMemoryId.data)
      .eq("user_id", user.id)
      .select(MEMORY_ITEM_SELECT)
      .maybeSingle<MemoryItemRow>()

    if (error) {
      throw new Error(error.message)
    }

    if (!data) {
      return NextResponse.json({ error: "Memory not found." }, { status: 404 })
    }

    return NextResponse.json({ success: true, memory: mapMemoryItemRowToDetail(data) })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to restore memory.",
        details: error instanceof Error ? error.message : "Unknown memory restore error.",
      },
      { status: 500 },
    )
  }
}
