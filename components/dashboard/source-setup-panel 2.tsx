"use client"

import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  ChevronDown,
  CheckCircle2,
  CircleDashed,
  Database,
  FileUp,
  Loader2,
  Mail,
  RefreshCw,
  Save,
  Upload,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
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
import { startGoogleSourceAuthorizationRedirect } from "@/lib/supabase/auth-actions"
import { cn } from "@/lib/utils"
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
    enabled: true,
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

function formatCapturedAt(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function sourceLabel(source: SourceSnapshotSummary["source"]) {
  return source.replace("_", " ")
}

function SectionLabel({
  icon: Icon,
  title,
  detail,
}: {
  icon: LucideIcon
  title: string
  detail?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-copper" aria-hidden="true" />
        <h3 className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground">{title}</h3>
      </div>
      {detail ? <span className="num shrink-0 text-[10px] uppercase text-muted-foreground">{detail}</span> : null}
    </div>
  )
}

function StatLine({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 rounded-sm border border-rule bg-secondary/10 px-3 py-2">
      <span className="block truncate text-[10px] uppercase text-muted-foreground">{label}</span>
      <span className="num mt-1 block text-[16px] font-semibold leading-none text-foreground">{value}</span>
    </div>
  )
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Button size="sm" variant="outline" className="h-8 justify-start gap-2 px-2.5 text-[11px]" onClick={onClick} disabled={disabled}>
      <Icon data-icon="inline-start" aria-hidden="true" />
      {label}
    </Button>
  )
}

function PanelHeader({ busy }: { busy: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 shrink-0 text-copper" aria-hidden="true" />
          <h2 className="truncate text-[13px] font-semibold uppercase text-foreground">Sources</h2>
        </div>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          Bring external context into the planner.
        </p>
      </div>
      <Badge variant="outline" className="shrink-0 gap-1 rounded-sm">
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        ) : (
          <CircleDashed className="h-3 w-3 text-copper" aria-hidden="true" />
        )}
        {busy ? "Working" : "Ready"}
      </Badge>
    </div>
  )
}

function SourceHealthSummary({
  failedCount,
  pendingCount,
  snapshotCount,
}: {
  failedCount: number
  pendingCount: number
  snapshotCount: number
}) {
  const healthy = failedCount === 0

  return (
    <div className="rounded-sm border border-rule bg-secondary/10 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {healthy ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-foreground">
              {healthy ? "Sources ready" : "Source refresh needs attention"}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {snapshotCount} snapshots · {pendingCount} review items
            </p>
          </div>
        </div>
        <Badge variant={healthy ? "secondary" : "destructive"} className="shrink-0 rounded-sm">
          {failedCount} failed
        </Badge>
      </div>
    </div>
  )
}

function SourceFailureAlert({ failedSources }: { failedSources: SourceSnapshotSummary[] }) {
  const [isOpen, setIsOpen] = useState(false)

  if (failedSources.length === 0) {
    return null
  }

  return (
    <Alert variant="destructive" className="min-w-0 rounded-sm border-destructive/40 bg-destructive/5 text-[12px]">
      <AlertTriangle aria-hidden="true" />
      <AlertTitle className="min-w-0 text-[12px]">
        {failedSources.length} source refresh issue{failedSources.length === 1 ? "" : "s"}
      </AlertTitle>
      <AlertDescription className="min-w-0 text-[12px]">
        <Collapsible open={isOpen} onOpenChange={setIsOpen} className="flex min-w-0 max-w-full flex-col gap-2">
          <p className="max-w-full leading-5 [overflow-wrap:anywhere]">
            Planning may be missing recent context until this source refresh succeeds.
          </p>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 justify-start px-0 text-destructive hover:bg-transparent">
              Details
              <ChevronDown data-icon="inline-end" aria-hidden="true" className={cn(isOpen && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="flex min-w-0 flex-col gap-2">
            {failedSources.map((source) => (
              <div key={source.id} className="min-w-0 rounded-sm border border-destructive/25 px-2.5 py-2">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium capitalize text-foreground">{sourceLabel(source.source)}</span>
                  <span className="num shrink-0 text-[10px] uppercase text-destructive/80">{formatCapturedAt(source.capturedAt)}</span>
                </div>
                <p className="mt-1 max-w-full leading-5 text-destructive/90 [overflow-wrap:anywhere]">{source.summary}</p>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      </AlertDescription>
    </Alert>
  )
}

function ConnectorStatus({
  icon: Icon,
  title,
  connector,
  action,
}: {
  icon: LucideIcon
  title: string
  connector: SourceConnector
  action: ReactNode
}) {
  return (
    <div className="min-w-0 rounded-sm border border-rule bg-secondary/10 px-3 py-3 text-[12px]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] gap-2">
          <Icon className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium text-foreground">{title}</span>
              <Badge variant={statusVariant(connector.status)} className="shrink-0 gap-1 rounded-sm">
                <StatusGlyph status={connector.status} />
                {getStatusLabel(connector.status)}
              </Badge>
            </div>
            <p className="mt-1 line-clamp-2 leading-5 text-muted-foreground">{connector.detail}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">{action}</div>
      </div>
    </div>
  )
}

function InlineError({ message }: { message: string }) {
  if (!message) {
    return null
  }

  return (
    <Alert variant="destructive" className="min-w-0 rounded-sm border-destructive/40 bg-destructive/5 text-[12px]">
      <AlertTriangle aria-hidden="true" />
      <AlertTitle className="text-[12px]">Source action failed</AlertTitle>
      <AlertDescription className="max-w-full text-[12px] leading-5 [overflow-wrap:anywhere]">
        {message}
      </AlertDescription>
    </Alert>
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
  const failedSources = sources.filter((source) => source.freshness === "failed")
  const busy = status === "busy"

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
      await startGoogleSourceAuthorizationRedirect("/dashboard")
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
    <section className="flex min-w-0 flex-col gap-5 pb-5">
      <PanelHeader busy={busy} />

      <div className="flex flex-col gap-2">
        <SectionLabel icon={failedSources.length > 0 ? AlertTriangle : CheckCircle2} title="Health" detail={failedSources.length > 0 ? "attention" : "clear"} />
        <SourceHealthSummary failedCount={failedSources.length} pendingCount={pendingCount} snapshotCount={sources.length} />
        <SourceFailureAlert failedSources={failedSources} />
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel icon={RefreshCw} title="Connectors" />
        <ConnectorStatus
          icon={Mail}
          title="Gmail"
          connector={gmailConnector}
          action={
            <ActionButton
              icon={gmailConnector.canRun ? RefreshCw : Mail}
              label={gmailConnector.canRun ? "Scan" : "Authorize"}
              onClick={gmailConnector.canRun ? handleGmailScan : handleGoogleAuthorize}
              disabled={busy || gmailConfigMissing}
            />
          }
        />
        <ConnectorStatus
          icon={BookOpen}
          title="Notion"
          connector={notionConnector}
          action={
            <>
              <ActionButton
                icon={BookOpen}
                label={notionConnector.status === "connected" ? "Reconnect" : "Connect"}
                onClick={handleNotionConnect}
                disabled={busy}
              />
              <ActionButton icon={CalendarDays} label="Import" onClick={handleNotionImport} disabled={busy} />
            </>
          }
        />
        <Field className="gap-2">
          <FieldLabel className="text-[12px]">Tasks Database</FieldLabel>
          <InputGroup className="min-w-0 rounded-sm border-rule bg-secondary/20">
            <InputGroupInput
              value={notionDatabaseInput}
              onChange={(event) => setNotionDatabaseInput(event.target.value)}
              placeholder="Paste Notion database URL or ID"
              disabled={busy || notionConnector.status === "missing_config"}
              className="min-w-0 text-[12px]"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                onClick={handleSaveNotionDatabase}
                disabled={busy || notionDatabaseInput.trim().length === 0 || notionConnector.status === "missing_config"}
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
      </div>

      <div className="flex flex-col gap-3">
        <SectionLabel icon={FileUp} title="Manual Intake" />
        <div>
          <ActionButton icon={FileUp} label="Upload" onClick={() => fileInputRef.current?.click()} disabled={busy} />
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
            <InputGroup className="min-w-0 rounded-sm border-rule bg-secondary/20">
              <InputGroupTextarea
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
                placeholder="Paste a syllabus chunk, club note, or loose task list."
                rows={4}
                disabled={busy}
              />
              <InputGroupAddon align="block-end" className="justify-between border-t border-rule">
                <FieldDescription className="text-[11px]">
                  {pasteText.trim().length.toLocaleString()} chars
                </FieldDescription>
                <InputGroupButton onClick={handlePaste} disabled={busy || pasteText.trim().length === 0}>
                  <Upload aria-hidden="true" />
                  Extract
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </Field>
        </FieldGroup>
      </div>

      <InlineError message={errorMessage} />

      <div className="flex flex-col gap-2">
        <SectionLabel icon={Database} title="Ledger" />
        <div className="grid grid-cols-4 gap-2">
          <StatLine label="Snap" value={sources.length} />
          <StatLine label="Files" value={sourceFiles.length} />
          <StatLine label="Review" value={pendingCount} />
          <StatLine label="Failed" value={failedSources.length} />
        </div>
      </div>
    </section>
  )
}
