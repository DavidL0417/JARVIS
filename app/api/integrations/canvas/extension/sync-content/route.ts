import { NextResponse } from "next/server"

import {
  CANVAS_EXTENSION_NODE_SELECT,
  deleteCanvasExtensionChildren,
  mapCanvasExtensionNode,
  upsertCanvasExtensionNodes,
} from "@/lib/sources/canvas-extension-control"
import { canvasHtmlToMarkdown, webpageHtmlToMarkdown } from "@/lib/sources/canvas-html-to-markdown"
import { requireCanvasExtensionToken } from "@/lib/supabase/canvas-extension-auth"
import { markCanvasExtensionTokenUsed } from "@/lib/supabase/canvas-extension-tokens"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { canvasExtensionSyncContentRequestSchema } from "@/schemas/canvas-extension"

function originFor(value: string) {
  return new URL(value).origin
}

export async function POST(request: Request) {
  const auth = await requireCanvasExtensionToken(request)

  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const body = await request.json().catch(() => null)
  const parsedBody = canvasExtensionSyncContentRequestSchema.safeParse(body)

  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Invalid Canvas extension sync payload.", issues: parsedBody.error.flatten() },
      { status: 400 },
    )
  }

  try {
    const { tokenRecord } = auth
    const data = parsedBody.data
    const canvasOrigin = originFor(data.canvasOrigin)

    if (tokenRecord.canvas_origin && tokenRecord.canvas_origin !== canvasOrigin) {
      return NextResponse.json(
        { error: "Canvas extension token is paired to a different Canvas origin." },
        { status: 403 },
      )
    }

    const adminClient = createSupabaseAdminClient()
    await markCanvasExtensionTokenUsed({ tokenId: tokenRecord.id, canvasOrigin })

    const courseResult = await adminClient
      .from("canvas_extension_nodes")
      .select(CANVAS_EXTENSION_NODE_SELECT)
      .eq("user_id", tokenRecord.user_id)
      .eq("canvas_origin", canvasOrigin)
      .eq("url", data.courseUrl)
      .maybeSingle()

    if (courseResult.error) {
      throw new Error(courseResult.error.message)
    }

    if (!courseResult.data) {
      return NextResponse.json({ error: "Canvas course not found. Run Discover first." }, { status: 404 })
    }

    const courseNode = mapCanvasExtensionNode(courseResult.data)

    if (data.replace !== false) {
      await deleteCanvasExtensionChildren({
        adminClient,
        userId: tokenRecord.user_id,
        parentNodeId: courseNode.id,
      })
    }

    const upserted = await upsertCanvasExtensionNodes({
      adminClient,
      userId: tokenRecord.user_id,
      nodes: data.items.map((item) => ({
        parentId: courseNode.id,
        canvasOrigin,
        url: item.url,
        title: item.title,
        kind: item.kind,
        textPreview: null,
        metadata: {
          level: "item",
          apiSource: item.apiSource,
          courseId: data.courseId,
          courseTitle: data.courseTitle ?? courseNode.title,
          dueAt: item.dueAt ?? null,
          selectedByParent: false,
          ...(item.metadata ?? {}),
        },
        selected: false,
        expanded: true,
      })),
    })

    await adminClient
      .from("canvas_extension_nodes")
      .update({ expanded: true, updated_at: new Date().toISOString() })
      .eq("user_id", tokenRecord.user_id)
      .eq("id", courseNode.id)

    const nodeIdByUrl = new Map(upserted.map((node) => [node.url, node.id]))
    const now = new Date().toISOString()
    const contentRows = data.items
      .map((item) => {
        if (!item.contentHtml || !item.contentHtml.trim()) return null
        // External readings are whole webpages from another origin; strip page chrome and
        // resolve their links against their own host rather than the Canvas origin.
        const { markdown, truncated } =
          item.kind === "external_link"
            ? webpageHtmlToMarkdown(item.contentHtml, { origin: originFor(item.url) })
            : canvasHtmlToMarkdown(item.contentHtml, { origin: canvasOrigin })
        if (!markdown) return null
        return {
          user_id: tokenRecord.user_id,
          node_id: nodeIdByUrl.get(item.url) ?? null,
          canvas_origin: canvasOrigin,
          url: item.url,
          title: item.title,
          content_markdown: markdown,
          api_source: item.apiSource,
          truncated,
          captured_at: now,
          updated_at: now,
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)

    if (contentRows.length > 0) {
      const { error: contentError } = await adminClient
        .from("canvas_extension_page_content")
        .upsert(contentRows, { onConflict: "user_id,canvas_origin,url" })

      if (contentError) {
        throw new Error(contentError.message)
      }
    }

    await adminClient.from("integrations").upsert(
      {
        user_id: tokenRecord.user_id,
        provider: "canvas",
        provider_account_email: null,
        provider_user_id: null,
        status: "connected",
        selected_calendar_id: null,
        selected_source_id: canvasOrigin,
        selected_source_name: new URL(canvasOrigin).host,
        last_synced_at: now,
      },
      { onConflict: "user_id,provider" },
    )

    return NextResponse.json({
      success: true,
      nodeCount: upserted.length,
      contentCount: contentRows.length,
      courseNodeId: courseNode.id,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to sync Canvas course content.",
        details: error instanceof Error ? error.message : "Unknown Canvas sync error.",
      },
      { status: 500 },
    )
  }
}
