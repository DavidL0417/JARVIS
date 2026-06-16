import { NextResponse } from "next/server"
import { z } from "zod"

import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"

// `action` is modeled as a discriminator so a future bulk-restore is a one-line
// addition. Only archive is implemented today, per scope.
const bulkMemorySchema = z.object({
  action: z.literal("archive"),
  ids: z
    .array(z.string().uuid())
    .min(1, "Select at least one memory.")
    .max(200, "Too many memories selected."),
})

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsedBody = bulkMemorySchema.safeParse(body)

  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Invalid bulk memory request", issues: parsedBody.error.flatten() },
      { status: 400 },
    )
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()

    const { data, error } = await adminClient
      .from("memory_items")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .in("id", parsedBody.data.ids)
      .select("id")

    if (error) {
      throw new Error(error.message)
    }

    return NextResponse.json({
      success: true,
      archivedIds: (data || []).map((row) => (row as { id: string }).id),
    })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to archive memories.",
        details: error instanceof Error ? error.message : "Unknown bulk memory error.",
      },
      { status: 500 },
    )
  }
}
