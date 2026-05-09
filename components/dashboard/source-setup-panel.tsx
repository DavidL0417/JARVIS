"use client"

import { useEffect, useRef, useState } from "react"
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  Database,
  FileUp,
  Loader2,
  Mail,
  Save,
  Upload,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
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
  InputGroupInput,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { startGoogleOAuthRedirect } from "@/lib/supabase/auth-actions"
import type {
  SourceCandidate,
  SourceConnector,
  SourceConnectorId,
  SourceConnectorStatus,
  SourceFileSummary,
  SourceSnapshotSummary,
} from "@/types"

type ActionStatus = "idle" | "busy" | "error"
type ActionPayload = {
  error?: string
  details?: string
  needsAuthorization?: boolean
  needsDatabaseSelection?: boolean
}

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

function getPayloadMessage(payload: ActionPayload | null, fallback: string) {
  return payload?.details || payload?.error || fallback
}

function StatLine({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-rule py-2 last:border-b-0">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="num text-[12px] font-medium text-foreground">{value}</span>
    </div>
  )
}

function getConnector(connectors: SourceConnector[], id: SourceConnectorId): SourceConnector {
  const connector = connectors.find((item) => item.id === id)

  if (connector) {
    return connector
  }

    return {
    id,
    status: "auth_needed",
    account: null,
    canRun: false,
    selectedSourceId: null,
    selectedSourceName: null,
    detail:
      id === "notion"
        ? "Authorize a Notion workspace before importing scheduling context."
        : "Authorize Google with Gmail read-only access before scanning mail context.",
  }
}

function getStatusLabel(status: SourceConnectorStatus) {
  if (status === "auth_needed") {
    return "auth needed"
  }

  if (status === "missing_config") {
    return "missing config"
  }

  return status
}

function statusVariant(status: SourceConnectorStatus): "outline" | "secondary" | "destructive" {
  if (status === "connected" || status === "ready") {
    return "secondary"
  }

  if (status === "failed" || status === "missing_config") {
    return "destructive"
  }

  return "outline"
}

function StatusGlyph({ status }: { status: SourceConnectorStatus }) {
  if (status === "connected" || status === "ready") {
    return <CheckCircle2 className="h-3 w-3 text-emerald-300" aria-hidden="true" />
  }

  if (status === "failed" || status === "missing_config") {
    return <AlertTriangle className="h-3 w-3 text-destructive" aria-hidden="true" />
  }

  return <CircleDashed className="h-3 w-3 text-copper" aria-hidden="true" />
}

function ConnectorStatus({
  icon: Icon,
  title,
  connector,
}: {
  icon: LucideIcon
  title: string
  connector: SourceConnector
}) {
  return (
    <div className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2 rounded-sm bg-secondary/15 px-3 py-2.5 text-[12px]">
      <Icon className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-foreground">{title}</span>
          <Badge variant={statusVariant(connector.status)} className="gap-1 rounded-sm">
            <StatusGlyph status={connector.status} />
            {getStatusLabel(connector.status)}
          </Badge>
        </div>
        <p className="mt-1 line-clamp-2 leading-5 text-muted-foreground">{connector.detail}</p>
      </div>
    </div>
  )
}

export function SourceSetupPanel({
  sourceConnectors,
  sources,
  sourceFiles,
  sourceCandidates,
  onSourcesChanged,
}: {
  sourceConnectors: SourceConnector[]
  sources: SourceSnapshotSummary[]
  sourceFiles: SourceFileSummary[]
  sourceCandidates: SourceCandidate[]
  onSourcesChanged: () => Promise<void>
}) {
  const notionConnector = getConnector(sourceConnectors, "notion")
  const gmailConnector = getConnector(sourceConnectors, "gmail")
  const gmailConfigMissing = gmailConnector.status === "missing_config"
  const [pasteText, setPasteText] = useState("")
  const [notionDatabaseInput, setNotionDatabaseInput] = useState(notionConnector.selectedSourceId ?? "")
  const [status, setStatus] = useState<ActionStatus>("idle")
  const [errorMessage, setErrorMessage] = useState("")
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pendingCount = sourceCandidates.filter((candidate) => candidate.status === "pending").length
  const failedCount = sources.filter((source) => source.freshness === "failed").length

  useEffect(() => {
    setNotionDatabaseInput(notionConnector.selectedSourceId ?? "")
  }, [notionConnector.selectedSourceId])

  async function runAction(action: () => Promise<void>) {
    setStatus("busy")
    setErrorMessage("")

    try {
      await action()
      await onSourcesChanged()
      setStatus("idle")
    } catch (error) {
      await onSourcesChanged().catch(() => undefined)
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

  async function startNotionAuthorization() {
    const response = await fetch("/api/integrations/notion/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ next: "/dashboard" }),
    })
    const payload = await readJson<{ authorizationUrl: string }>(response, "Notion authorization failed.")

    window.location.href = payload.authorizationUrl
  }

  async function handleNotionConnect() {
    await runAction(startNotionAuthorization)
  }

  async function handleNotionImport() {
    await runAction(async () => {
      const response = await fetch("/api/integrations/notion/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      const payload = (await response.json().catch(() => null)) as ActionPayload | null

      if (response.status === 409 && payload?.needsAuthorization) {
        await startNotionAuthorization()
        return
      }

      if (!response.ok || !payload) {
        throw new Error(getPayloadMessage(payload, "Notion import failed."))
      }
    })
  }

  async function handleSaveNotionDatabase() {
    const database = notionDatabaseInput.trim()

    if (!database) {
      setErrorMessage("Paste the authoritative Notion tasks database URL or ID.")
      setStatus("error")
      return
    }

    await runAction(async () => {
      const response = await fetch("/api/integrations/notion/database", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ database }),
      })

      await readJson(response, "Failed to save Notion tasks database.")
    })
  }

  async function handleGoogleAuthorize() {
    await runAction(async () => {
      await startGoogleOAuthRedirect("/dashboard")
    })
  }

  async function handleGmailScan() {
    await runAction(async () => {
      const response = await fetch("/api/gmail/sync", {
        method: "POST",
      })
      const payload = (await response.json().catch(() => null)) as ActionPayload | null

      if (!response.ok || !payload) {
        throw new Error(getPayloadMessage(payload, "Gmail scan failed."))
      }
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
          <FileUp data-icon="inline-start" aria-hidden="true" />
          Upload
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="justify-start gap-2"
          onClick={gmailConnector.canRun ? handleGmailScan : handleGoogleAuthorize}
          disabled={status === "busy" || gmailConfigMissing}
        >
          <Mail data-icon="inline-start" aria-hidden="true" />
          {gmailConnector.canRun ? "Scan Gmail" : "Authorize Gmail"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="justify-start gap-2"
          onClick={handleNotionConnect}
          disabled={status === "busy"}
        >
          <BookOpen data-icon="inline-start" aria-hidden="true" />
          {notionConnector.status === "connected" ? "Reconnect workspace" : "Connect workspace"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="justify-start gap-2"
          onClick={handleNotionImport}
          disabled={status === "busy"}
        >
          <CalendarDays data-icon="inline-start" aria-hidden="true" />
          Import Notion
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <ConnectorStatus
          icon={BookOpen}
          title="Notion"
          connector={notionConnector}
        />
        <Field className="gap-2">
          <FieldLabel className="text-[12px]">Tasks Database</FieldLabel>
          <InputGroup className="rounded-sm border-rule bg-secondary/20">
            <InputGroupInput
              value={notionDatabaseInput}
              onChange={(event) => setNotionDatabaseInput(event.target.value)}
              placeholder="Paste Notion database URL or ID"
              disabled={status === "busy" || notionConnector.status === "missing_config"}
              className="text-[12px]"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                onClick={handleSaveNotionDatabase}
                disabled={status === "busy" || notionDatabaseInput.trim().length === 0 || notionConnector.status === "missing_config"}
              >
                <Save aria-hidden="true" />
                Save
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <FieldDescription className="text-[11px]">
            {notionConnector.selectedSourceName
              ? `Authoritative: ${notionConnector.selectedSourceName}`
              : "Required before Notion import."}
          </FieldDescription>
        </Field>
        <ConnectorStatus
          icon={Mail}
          title="Gmail"
          connector={gmailConnector}
        />
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
