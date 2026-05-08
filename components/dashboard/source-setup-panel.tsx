"use client"

import { useRef, useState } from "react"
import { BookOpen, CalendarDays, Database, FileUp, Loader2, Mail, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { startGoogleOAuthRedirect } from "@/lib/supabase/auth-actions"
import type { SourceCandidate, SourceFileSummary, SourceSnapshotSummary } from "@/types"

type ActionStatus = "idle" | "busy" | "error"

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => null)

  if (!response.ok || !payload) {
    const detail =
      payload && typeof payload === "object" && "details" in payload && typeof payload.details === "string"
        ? payload.details
        : payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : fallback

    throw new Error(detail)
  }

  return payload as T
}

function StatLine({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-rule py-2 last:border-b-0">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="num text-[12px] font-medium text-foreground">{value}</span>
    </div>
  )
}

export function SourceSetupPanel({
  sources,
  sourceFiles,
  sourceCandidates,
  onSourcesChanged,
}: {
  sources: SourceSnapshotSummary[]
  sourceFiles: SourceFileSummary[]
  sourceCandidates: SourceCandidate[]
  onSourcesChanged: () => Promise<void>
}) {
  const [pasteText, setPasteText] = useState("")
  const [status, setStatus] = useState<ActionStatus>("idle")
  const [errorMessage, setErrorMessage] = useState("")
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pendingCount = sourceCandidates.filter((candidate) => candidate.status === "pending").length
  const failedCount = sources.filter((source) => source.freshness === "failed").length

  async function runAction(action: () => Promise<void>) {
    setStatus("busy")
    setErrorMessage("")

    try {
      await action()
      await onSourcesChanged()
      setStatus("idle")
    } catch (error) {
      setStatus("error")
      setErrorMessage(error instanceof Error ? error.message : "Source action failed.")
    }
  }

  async function handlePaste() {
    const text = pasteText.trim()

    if (!text) {
      return
    }

    await runAction(async () => {
      const response = await fetch("/api/sources/paste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "manual",
          label: "Quick context paste",
          text,
        }),
      })

      await readJson(response, "Paste extraction failed.")
      setPasteText("")
    })
  }

  async function handleUpload(file: File | null | undefined) {
    if (!file) {
      return
    }

    await runAction(async () => {
      const formData = new FormData()
      formData.set("file", file)
      formData.set("source", "manual")
      formData.set("sourceRef", file.name)
      const response = await fetch("/api/sources/upload", {
        method: "POST",
        body: formData,
      })

      await readJson(response, "Upload extraction failed.")
    })
  }

  async function handleNotionConnect() {
    await runAction(async () => {
      const response = await fetch("/api/integrations/notion/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ next: "/dashboard" }),
      })
      const payload = await readJson<{ authorizationUrl: string }>(response, "Notion authorization failed.")
      window.location.href = payload.authorizationUrl
    })
  }

  async function handleNotionImport() {
    await runAction(async () => {
      const response = await fetch("/api/integrations/notion/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })

      await readJson(response, "Notion import failed.")
    })
  }

  async function handleGmailScan() {
    await runAction(async () => {
      const response = await fetch("/api/gmail/sync", {
        method: "POST",
      })

      if (response.status === 409) {
        await startGoogleOAuthRedirect("/dashboard")
        return
      }

      await readJson(response, "Gmail scan failed.")
    })
  }

  return (
    <section className="flex flex-col gap-4 border-b border-rule pb-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-copper" aria-hidden="true" />
          <h2 className="text-[13px] font-semibold uppercase text-foreground">Sources</h2>
        </div>
        {status === "busy" ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" className="justify-start gap-2" onClick={() => fileInputRef.current?.click()} disabled={status === "busy"}>
          <FileUp aria-hidden="true" />
          Upload
        </Button>
        <Button size="sm" variant="outline" className="justify-start gap-2" onClick={handleGmailScan} disabled={status === "busy"}>
          <Mail aria-hidden="true" />
          Gmail
        </Button>
        <Button size="sm" variant="outline" className="justify-start gap-2" onClick={handleNotionConnect} disabled={status === "busy"}>
          <BookOpen aria-hidden="true" />
          Notion
        </Button>
        <Button size="sm" variant="outline" className="justify-start gap-2" onClick={handleNotionImport} disabled={status === "busy"}>
          <CalendarDays aria-hidden="true" />
          Import
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,image/png,image/jpeg,image/webp,text/plain,text/markdown,.txt,.md"
        className="hidden"
        onChange={(event) => {
          void handleUpload(event.target.files?.[0])
          event.currentTarget.value = ""
        }}
      />

      <FieldGroup className="gap-3">
        <Field className="gap-2">
          <FieldLabel className="text-[12px]">Paste Context</FieldLabel>
          <InputGroup className="rounded-sm border-rule bg-secondary/20">
            <InputGroupTextarea
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder="Paste a syllabus chunk, club note, or loose task list."
              rows={4}
              disabled={status === "busy"}
            />
            <InputGroupAddon align="block-end" className="justify-between border-t border-rule">
              <FieldDescription className="text-[11px]">
                {pasteText.trim().length.toLocaleString()} chars
              </FieldDescription>
              <InputGroupButton onClick={handlePaste} disabled={status === "busy" || pasteText.trim().length === 0}>
                <Upload aria-hidden="true" />
                Extract
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Field>
      </FieldGroup>

      <div className="rounded-sm border border-rule px-3">
        <StatLine label="Snapshots" value={sources.length} />
        <StatLine label="Originals" value={sourceFiles.length} />
        <StatLine label="Review" value={pendingCount} />
        <StatLine label="Failed" value={failedCount} />
      </div>

      {errorMessage ? (
        <p className="text-[12px] leading-5 text-destructive">{errorMessage}</p>
      ) : null}
    </section>
  )
}
