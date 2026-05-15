import { NextResponse } from "next/server"
import { z } from "zod"

import { MEMORY_ITEM_SELECT, mapMemoryItemRowToSummary } from "@/lib/data/mappers"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import type { MemoryItemRow } from "@/types"

const memoryIdSchema = z.string().uuid()

const updateMemorySchema = z.object({
  insight: z.string().trim().min(1, "Memory cannot be empty.").max(2000, "Memory is too long."),
})

async function getValidatedMemoryId(params: Promise<{ id: string }>) {
  const { id } = await params
  return memoryIdSchema.safeParse(id)
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsedMemoryId = await getValidatedMemoryId(context.params)
  const body = await request.json().catch(() => null)
  const parsedBody = updateMemorySchema.safeParse(body)

  if (!parsedMemoryId.success) {
    return NextResponse.json({ error: "Invalid memory id." }, { status: 400 })
  }

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid memory update request",
        issues: parsedBody.error.flatten(),
      },
      { status: 400 },
    )
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()

    const { data, error } = await adminClient
      .from("memory_items")
      .update({
        content: parsedBody.data.insight,
        source_label: "user_edit",
        updated_at: new Date().toISOString(),
      })
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

    return NextResponse.json({ success: true, memory: mapMemoryItemRowToSummary(data) })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to update memory.",
        details: error instanceof Error ? error.message : "Unknown memory update error.",
      },
      { status: 500 },
    )
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsedMemoryId = await getValidatedMemoryId(context.params)

  if (!parsedMemoryId.success) {
    return NextResponse.json({ error: "Invalid memory id." }, { status: 400 })
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()

    const { data, error } = await adminClient
      .from("memory_items")
      .update({
        status: "archived",
        updated_at: new Date().toISOString(),
      })
      .eq("id", parsedMemoryId.data)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle<{ id: string }>()

    if (error) {
      throw new Error(error.message)
    }

    if (!data) {
      return NextResponse.json({ error: "Memory not found." }, { status: 404 })
    }

    return NextResponse.json({ success: true, id: data.id })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to discard memory.",
        details: error instanceof Error ? error.message : "Unknown memory delete error.",
      },
      { status: 500 },
    )
  }
}
