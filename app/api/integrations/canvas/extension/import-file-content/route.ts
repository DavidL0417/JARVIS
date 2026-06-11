import { NextResponse } from "next/server"

import {
  CANVAS_EXTENSION_NODE_SELECT,
  mapCanvasExtensionNode,
  upsertCanvasExtensionNodes,
} from "@/lib/sources/canvas-extension-control"
import { requireCanvasExtensionToken } from "@/lib/supabase/canvas-extension-auth"
import { markCanvasExtensionTokenUsed } from "@/lib/supabase/canvas-extension-tokens"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { canvasExtensionFileContentMetadataSchema } from "@/schemas/canvas-extension"

const SOURCE_ORIGINALS_BUCKET = "source-originals"
const MAX_STORE_BYTES = 50 * 1024 * 1024

function originFor(value: string) {
  return new URL(value).origin
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim().slice(0, 140) || "canvas-file"
}

// Stores a Canvas file's bytes for in-app viewing (no text extraction — that is deferred to
// the Import step, see extract-stored-file). Files arrive with a blob for storable types;
// media/oversized files arrive metadata-only and become a note node with a Canvas link.
export async function POST(request: Request) {
  const auth = await requireCanvasExtensionToken(request)

  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 })
  }

  const metadataRaw = formData.get("metadata")
  const file = formData.get("file")
  let metadataJson: unknown = null
  if (typeof metadataRaw === "string") {
    try {
      metadataJson = JSON.parse(metadataRaw)
    } catch {
      metadataJson = null
    }
  }

  const parsedMetadata = canvasExtensionFileContentMetadataSchema.safeParse(metadataJson)
  if (!parsedMetadata.success) {
    return NextResponse.json(
      { error: "Invalid Canvas file metadata.", issues: parsedMetadata.error.flatten() },
      { status: 400 },
    )
  }

  try {
    const { tokenRecord } = auth
    const metadata = parsedMetadata.data
    const canvasOrigin = originFor(metadata.canvasOrigin)

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
      .eq("url", metadata.courseUrl)
      .maybeSingle()

    if (courseResult.error) {
      throw new Error(courseResult.error.message)
    }

    if (!courseResult.data) {
      return NextResponse.json({ error: "Canvas course not found. Run Discover first." }, { status: 404 })
    }

    const courseNode = mapCanvasExtensionNode(courseResult.data)

    let storagePath: string | null = null
    let note: string | null = null

    if (file instanceof Blob && file.size > 0 && file.size <= MAX_STORE_BYTES) {
      const fileName = sanitizeFileName(metadata.fileName)
      const buffer = Buffer.from(await file.arrayBuffer())
      const path = `${tokenRecord.user_id}/canvas/${crypto.randomUUID()}-${fileName}`
      const { error: uploadError } = await adminClient.storage
        .from(SOURCE_ORIGINALS_BUCKET)
        .upload(path, buffer, { contentType: metadata.mimeType, upsert: false })

      if (uploadError) {
        throw new Error(uploadError.message)
      }
      storagePath = path
    } else {
      note = metadata.sizeBytes > MAX_STORE_BYTES
        ? `This file is ${Math.round(metadata.sizeBytes / (1024 * 1024))} MB — too large to load in app. Open it in Canvas.`
        : "This file type isn't viewable in app. Open it in Canvas."
    }

    const stored = storagePath !== null

    await upsertCanvasExtensionNodes({
      adminClient,
      userId: tokenRecord.user_id,
      nodes: [
        {
          parentId: courseNode.id,
          canvasOrigin,
          url: metadata.url,
          title: metadata.title,
          kind: "file",
          textPreview: null,
          metadata: {
            level: "item",
            apiSource: "file",
            courseId: metadata.courseId,
            courseTitle: metadata.courseTitle ?? courseNode.title,
            actualUrl: metadata.url,
            fileId: metadata.fileId ?? null,
            contentType: metadata.mimeType,
            sizeBytes: metadata.sizeBytes,
            storagePath,
            viewable: stored,
            extracted: false,
            selectedByParent: false,
          },
          selected: false,
          expanded: true,
        },
      ],
    })

    if (!stored && note) {
      const now = new Date().toISOString()
      const { error: contentError } = await adminClient.from("canvas_extension_page_content").upsert(
        {
          user_id: tokenRecord.user_id,
          node_id: null,
          canvas_origin: canvasOrigin,
          url: metadata.url,
          title: metadata.title,
          content_markdown: `> ${note}`,
          api_source: "file",
          truncated: false,
          captured_at: now,
          updated_at: now,
        },
        { onConflict: "user_id,canvas_origin,url" },
      )

      if (contentError) {
        throw new Error(contentError.message)
      }
    }

    return NextResponse.json({ success: true, stored, viewable: stored })
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to store Canvas file.",
        details: error instanceof Error ? error.message : "Unknown Canvas file error.",
      },
      { status: 500 },
    )
  }
}
