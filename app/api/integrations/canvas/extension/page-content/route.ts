import { NextResponse } from "next/server"
import { z } from "zod"

import {
  isAuthBackendDependencyError,
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"

const nodeIdSchema = z.string().uuid()

export async function GET(request: Request) {
  const nodeId = new URL(request.url).searchParams.get("nodeId")
  const parsedNodeId = nodeIdSchema.safeParse(nodeId)

  if (!parsedNodeId.success) {
    return NextResponse.json({ success: false, error: "A valid nodeId query parameter is required." }, { status: 400 })
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const contentSelect = "content_markdown, api_source, truncated, captured_at, title, url"
    const byNode = await adminClient
      .from("canvas_extension_page_content")
      .select(contentSelect)
      .eq("user_id", user.id)
      .eq("node_id", parsedNodeId.data)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (byNode.error) {
      throw new Error(byNode.error.message)
    }

    let data = byNode.data

    // Fallback: content may be keyed by URL when node_id was not yet known at store time.
    if (!data) {
      const nodeResult = await adminClient
        .from("canvas_extension_nodes")
        .select("url, metadata")
        .eq("user_id", user.id)
        .eq("id", parsedNodeId.data)
        .maybeSingle()

      if (nodeResult.error) {
        throw new Error(nodeResult.error.message)
      }

      const metadata = (nodeResult.data?.metadata ?? {}) as Record<string, unknown>
      const candidateUrls = [
        nodeResult.data?.url,
        typeof metadata.actualUrl === "string" ? metadata.actualUrl : null,
      ].filter((value): value is string => Boolean(value))

      if (candidateUrls.length > 0) {
        const byUrl = await adminClient
          .from("canvas_extension_page_content")
          .select(contentSelect)
          .eq("user_id", user.id)
          .in("url", candidateUrls)
          .order("captured_at", { ascending: false })
          .limit(1)
          .maybeSingle()

        if (byUrl.error) {
          throw new Error(byUrl.error.message)
        }

        data = byUrl.data
      }
    }

    if (!data) {
      return NextResponse.json({ success: true, content: null })
    }

    return NextResponse.json({
      success: true,
      content: {
        markdown: data.content_markdown,
        apiSource: data.api_source,
        truncated: data.truncated,
        capturedAt: data.captured_at,
        title: data.title,
        url: data.url,
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
        error: "Failed to load Canvas page content.",
        details: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 500 },
    )
  }
}
