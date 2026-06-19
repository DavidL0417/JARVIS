import { NextResponse } from "next/server"

import { extractCanvasExtensionPage } from "@/lib/sources/canvas-extension-extraction"
import { canvasHtmlToMarkdown } from "@/lib/sources/canvas-html-to-markdown"
import { insertAndAutoApproveSourceCandidates, insertSourceSnapshot } from "@/lib/sources/persistence"
import {
  markCanvasExtensionTokenUsed,
} from "@/lib/supabase/canvas-extension-tokens"
import { requireCanvasExtensionToken } from "@/lib/supabase/canvas-extension-auth"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import {
  canvasExtensionImportPageRequestSchema,
  canvasExtensionImportPageResponseSchema,
} from "@/schemas/canvas-extension"
import type {
  CanvasExtensionImportPageResponse,
  CanvasExtensionPageSnapshot,
} from "@/schemas/canvas-extension"

function originFor(value: string) {
  return new URL(value).origin
}

export async function POST(request: Request) {
  const auth = await requireCanvasExtensionToken(request)

  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const body = await request.json().catch(() => null)
  const parsedBody = canvasExtensionImportPageRequestSchema.safeParse(body)

  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: "Invalid Canvas extension page import.",
        issues: parsedBody.error.flatten(),
      },
      { status: 400 },
    )
  }

  try {
    const { tokenRecord } = auth
    const data = parsedBody.data
    const canvasOrigin = originFor(data.canvasOrigin)

    if (tokenRecord.canvas_origin && tokenRecord.canvas_origin !== canvasOrigin) {
      return NextResponse.json(
        {
          error: "Canvas extension token is paired to a different Canvas origin.",
        },
        { status: 403 },
      )
    }

    let markdown: string | null = null
    let truncated = false
    let apiSource: string | null = null
    let contentNodeId: string | null = null
    let snapshot: CanvasExtensionPageSnapshot

    if ("apiSource" in data) {
      const converted = canvasHtmlToMarkdown(data.contentHtml, { origin: canvasOrigin })
      markdown = converted.markdown
      truncated = converted.truncated
      apiSource = data.apiSource
      contentNodeId = data.nodeId ?? null
      snapshot = {
        scanId: data.scanId,
        canvasOrigin: data.canvasOrigin,
        url: data.url,
        title: data.title,
        courseHint: data.courseHint,
        pageKindHint: data.pageKindHint ?? data.apiSource,
        visibleText: markdown || data.title,
        links: data.links ?? [],
        capturedAt: data.capturedAt,
      }
    } else {
      snapshot = data
    }

    const isApiContent = apiSource !== null

    const adminClient = createSupabaseAdminClient()
    await markCanvasExtensionTokenUsed({
      tokenId: tokenRecord.id,
      canvasOrigin,
    })

    const { error: integrationError } = await adminClient.from("integrations").upsert(
      {
        user_id: tokenRecord.user_id,
        provider: "canvas",
        provider_account_email: null,
        provider_user_id: null,
        status: "connected",
        selected_calendar_id: null,
        selected_source_id: canvasOrigin,
        selected_source_name: new URL(canvasOrigin).host,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" },
    )

    if (integrationError) {
      throw new Error(integrationError.message)
    }

    const extraction = await extractCanvasExtensionPage(snapshot)
    const sourceSnapshot = await insertSourceSnapshot({
      adminClient,
      userId: tokenRecord.user_id,
      source: "canvas",
      sourceRef: snapshot.url,
      freshness: extraction.skippedReason ? "partial" : "fresh",
      summary: extraction.summary,
      payload: {
        mode: isApiContent ? "extension_api_reader" : "extension_page_reader",
        scanId: snapshot.scanId,
        canvasOrigin,
        url: snapshot.url,
        title: snapshot.title,
        courseHint: snapshot.courseHint,
        pageKindHint: snapshot.pageKindHint,
        apiSource,
        pageKind: extraction.pageKind,
        confidence: extraction.confidence,
        skippedReason: extraction.skippedReason,
        model: extraction.model,
        textPreview: snapshot.visibleText.slice(0, 1600),
        linkCount: snapshot.links.length,
        truncated,
        capturedAt: snapshot.capturedAt,
      },
    })

    if (isApiContent && markdown) {
      const { error: contentError } = await adminClient.from("canvas_extension_page_content").upsert(
        {
          user_id: tokenRecord.user_id,
          node_id: contentNodeId,
          canvas_origin: canvasOrigin,
          url: snapshot.url,
          title: snapshot.title,
          content_markdown: markdown,
          api_source: apiSource,
          source_snapshot_id: sourceSnapshot.id,
          truncated,
          captured_at: snapshot.capturedAt,
        },
        { onConflict: "user_id,canvas_origin,url" },
      )

      if (contentError) {
        throw new Error(contentError.message)
      }
    }

    const candidates = extraction.skippedReason
      ? []
      : await insertAndAutoApproveSourceCandidates({
          adminClient,
          userId: tokenRecord.user_id,
          sourceSnapshotId: sourceSnapshot.id,
          candidates: extraction.extractedCandidates,
          externalSource: "canvas",
        })
    const responsePayload: CanvasExtensionImportPageResponse = {
      success: true,
      sourceSnapshotId: sourceSnapshot.id,
      candidates,
      ledgerItem: {
        url: snapshot.url,
        status: extraction.skippedReason ? "skipped" : "imported",
        reason: extraction.skippedReason ?? extraction.summary,
        candidateCount: candidates.length,
      },
    }

    return NextResponse.json(canvasExtensionImportPageResponseSchema.parse(responsePayload))
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to import Canvas extension page.",
        details: error instanceof Error ? error.message : "Unknown Canvas extension import error.",
      },
      { status: 500 },
    )
  }
}
