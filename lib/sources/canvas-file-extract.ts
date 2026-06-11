import { canvasHtmlToMarkdown } from "@/lib/sources/canvas-html-to-markdown"

export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const MAX_PDF_PAGES = 35
const MAX_TEXT_CHARS = 200_000

export interface CanvasFileExtractResult {
  markdown: string
  extracted: boolean
  pageCount: number | null
  reason: string | null
}

function isPdf(mimeType: string, fileName: string) {
  return mimeType.includes("pdf") || /\.pdf$/i.test(fileName)
}

function isDocx(mimeType: string, fileName: string) {
  return mimeType.includes("officedocument.wordprocessingml") || /\.docx$/i.test(fileName)
}

function normalizeText(value: string): { markdown: string; truncated: boolean } {
  const cleaned = value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
  if (cleaned.length <= MAX_TEXT_CHARS) {
    return { markdown: cleaned, truncated: false }
  }
  return { markdown: `${cleaned.slice(0, MAX_TEXT_CHARS).trimEnd()}\n\n_(content truncated)_`, truncated: true }
}

/**
 * Extracts readable text from a Canvas file download (PDF or Word) into markdown.
 * PDFs over MAX_PDF_PAGES are skipped with a reason; very large files are rejected by
 * the caller via MAX_FILE_BYTES.
 */
export async function extractFileText(input: {
  bytes: ArrayBuffer
  mimeType: string
  fileName: string
  origin?: string
}): Promise<CanvasFileExtractResult> {
  const { bytes, mimeType, fileName } = input

  if (bytes.byteLength > MAX_FILE_BYTES) {
    return {
      markdown: "",
      extracted: false,
      pageCount: null,
      reason: `File is too large to read in app (${Math.round(bytes.byteLength / (1024 * 1024))} MB).`,
    }
  }

  if (isPdf(mimeType, fileName)) {
    const { extractText, getDocumentProxy } = await import("unpdf")
    const pdf = await getDocumentProxy(new Uint8Array(bytes))
    const pageCount = pdf.numPages

    if (pageCount > MAX_PDF_PAGES) {
      return {
        markdown: "",
        extracted: false,
        pageCount,
        reason: `PDF has ${pageCount} pages, over the ${MAX_PDF_PAGES}-page limit.`,
      }
    }

    const result = await extractText(pdf, { mergePages: true })
    const rawText = Array.isArray(result.text) ? result.text.join("\n\n") : result.text
    const { markdown, truncated } = normalizeText(rawText || "")

    if (!markdown) {
      return { markdown: "", extracted: false, pageCount, reason: "No selectable text found (the PDF may be scanned)." }
    }

    return { markdown, extracted: true, pageCount, reason: truncated ? "Content truncated." : null }
  }

  if (isDocx(mimeType, fileName)) {
    const mammoth = await import("mammoth")
    // convertToHtml preserves headings/bold/italics/lists/tables, which we then turn into
    // markdown (extractRawText would flatten everything to plain text).
    const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })

    if (html && html.trim()) {
      const converted = canvasHtmlToMarkdown(html, { origin: input.origin ?? "https://canvas.instructure.com" })
      if (converted.markdown) {
        return { markdown: converted.markdown, extracted: true, pageCount: null, reason: converted.truncated ? "Content truncated." : null }
      }
    }

    const { value: rawText } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) })
    const { markdown, truncated } = normalizeText(rawText || "")

    if (!markdown) {
      return { markdown: "", extracted: false, pageCount: null, reason: "No text found in document." }
    }

    return { markdown, extracted: true, pageCount: null, reason: truncated ? "Content truncated." : null }
  }

  return { markdown: "", extracted: false, pageCount: null, reason: "Unsupported file type for in-app reading." }
}
