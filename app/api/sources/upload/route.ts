import { NextResponse } from "next/server"

import { extractCandidatesFromFile } from "@/lib/sources/extraction"
import {
  insertSourceCandidates,
  insertSourceFile,
  insertSourceSnapshot,
  updateSourceFileStatus,
} from "@/lib/sources/persistence"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { sourceKindSchema } from "@/schemas/common"
import { sourceIntakeResponseSchema } from "@/schemas/sources"
import type { SourceIntakeResponse } from "@/schemas/sources"
import type { SourceFileSummary, SourceKind } from "@/types"

const SOURCE_ORIGINALS_BUCKET = "source-originals"
const MAX_SOURCE_BYTES = 50 * 1024 * 1024

function sanitizeFileName(fileName: string) {
  return fileName
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140) || "source"
}

function getFormText(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === "string" && value.trim() ? value.trim() : null
}

async function recordExtractionFailure(input: {
  adminClient: Awaited<ReturnType<typeof requireAuthenticatedUser>>["adminClient"]
  userId: string
  source: SourceKind
  sourceRef: string | null
  sourceFile: SourceFileSummary | null
  message: string
}) {
  if (input.sourceFile) {
    await updateSourceFileStatus({
      adminClient: input.adminClient,
      userId: input.userId,
      sourceFileId: input.sourceFile.id,
      status: "failed",
      errorMessage: input.message,
    })
  }

  await insertSourceSnapshot({
    adminClient: input.adminClient,
    userId: input.userId,
    source: input.source,
    sourceRef: input.sourceRef,
    freshness: "failed",
    summary: `Source extraction failed: ${input.message}`,
    payload: {
      sourceFileId: input.sourceFile?.id ?? null,
    },
  })
}

export async function POST(request: Request) {
  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const formData = await request.formData()
    const rawFile = formData.get("file")
    const sourceParse = sourceKindSchema.safeParse(getFormText(formData, "source") ?? "manual")
    const sourceRef = getFormText(formData, "sourceRef")

    if (!sourceParse.success) {
      return NextResponse.json({ error: "Invalid source kind." }, { status: 400 })
    }

    if (!(rawFile instanceof File)) {
      return NextResponse.json({ error: "Upload request must include a file." }, { status: 400 })
    }

    if (rawFile.size <= 0) {
      return NextResponse.json({ error: "Uploaded file is empty." }, { status: 400 })
    }

    if (rawFile.size > MAX_SOURCE_BYTES) {
      return NextResponse.json({ error: "Uploaded file exceeds the 50 MB source limit." }, { status: 400 })
    }

    const fileName = sanitizeFileName(rawFile.name)
    const mimeType = rawFile.type || "application/octet-stream"
    const buffer = Buffer.from(await rawFile.arrayBuffer())
    const storagePath = `${user.id}/${crypto.randomUUID()}-${fileName}`

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
      userId: user.id,
      source: sourceParse.data,
      sourceRef,
      fileName,
      mimeType,
      storagePath,
      sizeBytes: rawFile.size,
      status: "processing",
    })

    let extraction

    try {
      extraction = await extractCandidatesFromFile({
        source: sourceParse.data,
        sourceRef,
        fileName,
        mimeType,
        buffer,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown source extraction error."
      await recordExtractionFailure({
        adminClient,
        userId: user.id,
        source: sourceParse.data,
        sourceRef: sourceRef ?? fileName,
        sourceFile,
        message,
      })
      throw error
    }

    const updatedSourceFile = await updateSourceFileStatus({
      adminClient,
      userId: user.id,
      sourceFileId: sourceFile.id,
      status: "processed",
    })
    const sourceSnapshot = await insertSourceSnapshot({
      adminClient,
      userId: user.id,
      source: sourceParse.data,
      sourceRef: sourceRef ?? fileName,
      freshness: "fresh",
      summary: extraction.summary,
      payload: {
        sourceFileId: updatedSourceFile.id,
        storagePath,
        mimeType,
        model: extraction.model,
        candidateCount: extraction.candidates.length,
      },
    })
    const candidates = await insertSourceCandidates({
      adminClient,
      userId: user.id,
      sourceSnapshotId: sourceSnapshot.id,
      sourceFileId: updatedSourceFile.id,
      candidates: extraction.candidates,
    })
    const responsePayload: SourceIntakeResponse = {
      success: true,
      sourceSnapshot,
      sourceFile: updatedSourceFile,
      candidates,
    }
    const parsedResponse = sourceIntakeResponseSchema.safeParse(responsePayload)

    if (!parsedResponse.success) {
      return NextResponse.json(
        {
          error: "Invalid source upload response payload",
          issues: parsedResponse.error.flatten(),
        },
        { status: 500 },
      )
    }

    return NextResponse.json(parsedResponse.data)
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to upload and extract source.",
        details: error instanceof Error ? error.message : "Unknown source upload error.",
      },
      { status: 500 },
    )
  }
}
