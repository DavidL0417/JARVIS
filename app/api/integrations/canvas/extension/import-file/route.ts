import { NextResponse } from "next/server"

import {
  insertSourceFile,
  insertSourceSnapshot,
} from "@/lib/sources/persistence"
import { requireCanvasExtensionToken } from "@/lib/supabase/canvas-extension-auth"
import { canvasExtensionImportFileMetadataSchema } from "@/schemas/canvas-extension"

const SOURCE_ORIGINALS_BUCKET = "source-originals"
const MAX_SOURCE_BYTES = 50 * 1024 * 1024

function sanitizeFileName(fileName: string) {
  return fileName
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140) || "canvas-file"
}

export async function POST(request: Request) {
  try {
    const auth = await requireCanvasExtensionToken(request)

    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { adminClient, tokenRecord } = auth
    const formData = await request.formData()
    const metadataValue = formData.get("metadata")
    const rawFile = formData.get("file")
    const metadataPayload = typeof metadataValue === "string"
      ? JSON.parse(metadataValue)
      : null
    const metadata = canvasExtensionImportFileMetadataSchema.safeParse(
      metadataPayload,
    )

    if (!metadata.success) {
      return NextResponse.json(
        {
          error: "Invalid Canvas file import metadata.",
          issues: metadata.error.flatten(),
        },
        { status: 400 },
      )
    }

    const fileMetadata = metadata.data

    if (fileMetadata.metadataOnly || fileMetadata.sizeBytes > MAX_SOURCE_BYTES || !(rawFile instanceof File)) {
      const snapshot = await insertSourceSnapshot({
        adminClient,
        userId: tokenRecord.user_id,
        source: "canvas",
        sourceRef: fileMetadata.url,
        freshness: "partial",
        summary: fileMetadata.reason || `Canvas file recorded but not downloaded: ${fileMetadata.fileName}`,
        payload: {
          mode: "extension_file_metadata",
          canvasOrigin: fileMetadata.canvasOrigin,
          url: fileMetadata.url,
          title: fileMetadata.title,
          fileName: fileMetadata.fileName,
          mimeType: fileMetadata.mimeType,
          sizeBytes: fileMetadata.sizeBytes,
          nodeId: fileMetadata.nodeId ?? null,
        },
      })

      return NextResponse.json({
        success: true,
        sourceSnapshotId: snapshot.id,
        sourceFileId: null,
        metadataOnly: true,
      })
    }

    if (rawFile.size > MAX_SOURCE_BYTES) {
      return NextResponse.json({ error: "Canvas file exceeds the 50 MB source limit." }, { status: 400 })
    }

    const fileName = sanitizeFileName(fileMetadata.fileName || rawFile.name)
    const mimeType = rawFile.type || fileMetadata.mimeType || "application/octet-stream"
    const buffer = Buffer.from(await rawFile.arrayBuffer())
    const storagePath = `${tokenRecord.user_id}/${crypto.randomUUID()}-${fileName}`
    const { error: uploadError } = await adminClient.storage
      .from(SOURCE_ORIGINALS_BUCKET)
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: false,
      })

    if (uploadError) {
      throw new Error(uploadError.message)
    }

    const sourceFile = await insertSourceFile({
      adminClient,
      userId: tokenRecord.user_id,
      source: "canvas",
      sourceRef: fileMetadata.url,
      fileName,
      mimeType,
      storagePath,
      sizeBytes: rawFile.size,
      status: "ready",
    })
    const snapshot = await insertSourceSnapshot({
      adminClient,
      userId: tokenRecord.user_id,
      source: "canvas",
      sourceRef: fileMetadata.url,
      freshness: "fresh",
      summary: `Canvas file stored for later extraction: ${fileName}`,
      payload: {
        mode: "extension_file_stored",
        canvasOrigin: fileMetadata.canvasOrigin,
        url: fileMetadata.url,
        title: fileMetadata.title,
        sourceFileId: sourceFile.id,
        storagePath,
        mimeType,
        sizeBytes: rawFile.size,
        nodeId: fileMetadata.nodeId ?? null,
      },
    })

    return NextResponse.json({
      success: true,
      sourceSnapshotId: snapshot.id,
      sourceFileId: sourceFile.id,
      metadataOnly: false,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to import Canvas file.",
        details: error instanceof Error ? error.message : "Unknown Canvas file import error.",
      },
      { status: 500 },
    )
  }
}
