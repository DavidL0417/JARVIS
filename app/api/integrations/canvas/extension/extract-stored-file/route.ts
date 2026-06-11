import { NextResponse } from "next/server"
import { z } from "zod"

import { CANVAS_EXTENSION_NODE_SELECT, mapCanvasExtensionNode } from "@/lib/sources/canvas-extension-control"
import { extractCanvasExtensionPage } from "@/lib/sources/canvas-extension-extraction"
import { extractFileText } from "@/lib/sources/canvas-file-extract"
import { insertAndAutoApproveSourceCandidates, insertSourceSnapshot } from "@/lib/sources/persistence"
import { requireCanvasExtensionToken } from "@/lib/supabase/canvas-extension-auth"
import { markCanvasExtensionTokenUsed } from "@/lib/supabase/canvas-extension-tokens"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

const SOURCE_ORIGINALS_BUCKET = "source-originals"
const bodySchema = z.object({ nodeId: z.string().uuid() })

// Runs when a stored file is imported into Jarvis: downloads the stored bytes, extracts text
// to markdown, runs the candidate extractor, and marks the node imported. Text extraction is
// deliberately deferred to this step (viewing only stores the file).
export async function POST(request: Request) {
  const auth = await requireCanvasExtensionToken(request)

  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const body = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "A valid nodeId is required." }, { status: 400 })
  }

  try {
    const { tokenRecord } = auth
    const adminClient = createSupabaseAdminClient()

    const nodeResult = await adminClient
      .from("canvas_extension_nodes")
      .select(CANVAS_EXTENSION_NODE_SELECT)
      .eq("user_id", tokenRecord.user_id)
      .eq("id", parsed.data.nodeId)
      .maybeSingle()

    if (nodeResult.error) {
      throw new Error(nodeResult.error.message)
    }
    if (!nodeResult.data) {
      return NextResponse.json({ error: "Canvas node not found." }, { status: 404 })
    }

    const node = mapCanvasExtensionNode(nodeResult.data)
    const meta = node.metadata as Record<string, unknown>
    const origin = new URL(node.canvasOrigin).origin
    const storagePath = typeof meta.storagePath === "string" ? meta.storagePath : null
    const mimeType = typeof meta.contentType === "string" ? meta.contentType : "application/octet-stream"

    if (tokenRecord.canvas_origin && tokenRecord.canvas_origin !== origin) {
      return NextResponse.json({ error: "Canvas extension token is paired to a different Canvas origin." }, { status: 403 })
    }

    await markCanvasExtensionTokenUsed({ tokenId: tokenRecord.id, canvasOrigin: origin })

    const now = new Date().toISOString()

    if (!storagePath) {
      await adminClient
        .from("canvas_extension_nodes")
        .update({ imported_at: now, updated_at: now })
        .eq("user_id", tokenRecord.user_id)
        .eq("id", node.id)
      return NextResponse.json({ success: true, extracted: false, candidateCount: 0, reason: "File not stored for extraction." })
    }

    const download = await adminClient.storage.from(SOURCE_ORIGINALS_BUCKET).download(storagePath)
    if (download.error || !download.data) {
      throw new Error(download.error?.message ?? "Failed to download the stored file.")
    }
    const bytes = await download.data.arrayBuffer()
    const extraction = await extractFileText({ bytes, mimeType, fileName: node.title, origin })

    const markdown = extraction.extracted && extraction.markdown
      ? extraction.markdown
      : `> ${extraction.reason ?? "This file could not be read."}`

    const { error: contentError } = await adminClient.from("canvas_extension_page_content").upsert(
      {
        user_id: tokenRecord.user_id,
        node_id: node.id,
        canvas_origin: origin,
        url: node.url,
        title: node.title,
        content_markdown: markdown,
        api_source: "file",
        truncated: extraction.reason === "Content truncated.",
        captured_at: now,
        updated_at: now,
      },
      { onConflict: "user_id,canvas_origin,url" },
    )
    if (contentError) {
      throw new Error(contentError.message)
    }

    let candidateCount = 0
    let sourceSnapshotId: string | null = null

    if (extraction.extracted && extraction.markdown) {
      const result = await extractCanvasExtensionPage({
        scanId: `canvas-file-${node.id}`,
        canvasOrigin: origin,
        url: node.url,
        title: node.title,
        courseHint: typeof meta.courseTitle === "string" ? meta.courseTitle : null,
        pageKindHint: "file",
        visibleText: extraction.markdown,
        links: [],
        capturedAt: now,
      })
      const snapshot = await insertSourceSnapshot({
        adminClient,
        userId: tokenRecord.user_id,
        source: "canvas",
        sourceRef: node.url,
        freshness: result.skippedReason ? "partial" : "fresh",
        summary: result.summary,
        payload: { mode: "extension_file_reader", url: node.url, title: node.title, pageKind: result.pageKind, model: result.model, storagePath },
      })
      sourceSnapshotId = snapshot.id
      const candidates = result.skippedReason
        ? []
        : await insertAndAutoApproveSourceCandidates({
            adminClient,
            userId: tokenRecord.user_id,
            sourceSnapshotId: snapshot.id,
            candidates: result.extractedCandidates,
          })
      candidateCount = candidates.length
    }

    await adminClient
      .from("canvas_extension_nodes")
      .update({
        imported_at: now,
        source_snapshot_id: sourceSnapshotId,
        metadata: { ...meta, extracted: extraction.extracted, pageCount: extraction.pageCount, reason: extraction.reason },
        updated_at: now,
      })
      .eq("user_id", tokenRecord.user_id)
      .eq("id", node.id)

    return NextResponse.json({ success: true, extracted: extraction.extracted, candidateCount, reason: extraction.reason })
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to extract Canvas file.",
        details: error instanceof Error ? error.message : "Unknown error.",
      },
      { status: 500 },
    )
  }
}
