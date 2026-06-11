import { NextResponse } from "next/server"
import { z } from "zod"

import {
  isAuthBackendDependencyError,
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"

const SOURCE_ORIGINALS_BUCKET = "source-originals"
const SIGNED_URL_TTL_SECONDS = 60 * 60
const nodeIdSchema = z.string().uuid()

export async function GET(request: Request) {
  const nodeId = new URL(request.url).searchParams.get("nodeId")
  const parsedNodeId = nodeIdSchema.safeParse(nodeId)

  if (!parsedNodeId.success) {
    return NextResponse.json({ success: false, error: "A valid nodeId query parameter is required." }, { status: 400 })
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const { data, error } = await adminClient
      .from("canvas_extension_nodes")
      .select("metadata, title")
      .eq("user_id", user.id)
      .eq("id", parsedNodeId.data)
      .maybeSingle()

    if (error) {
      throw new Error(error.message)
    }

    const metadata = (data?.metadata ?? {}) as Record<string, unknown>
    const storagePath = typeof metadata.storagePath === "string" ? metadata.storagePath : null

    if (!storagePath) {
      return NextResponse.json({ success: true, file: null })
    }

    const signed = await adminClient.storage
      .from(SOURCE_ORIGINALS_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)

    if (signed.error || !signed.data?.signedUrl) {
      throw new Error(signed.error?.message ?? "Failed to sign Canvas file URL.")
    }

    return NextResponse.json({
      success: true,
      file: {
        url: signed.data.signedUrl,
        mimeType: typeof metadata.contentType === "string" ? metadata.contentType : "application/octet-stream",
        sizeBytes: typeof metadata.sizeBytes === "number" ? metadata.sizeBytes : null,
        fileName: data?.title ?? "file",
      },
    })
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 })
    }

    if (isAuthBackendDependencyError(error)) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.code === "backend_timeout" ? 503 : 502 },
      )
    }

    return NextResponse.json(
      {
        success: false,
        error: "Failed to load Canvas file URL.",
        details: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 500 },
    )
  }
}
