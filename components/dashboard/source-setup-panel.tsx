"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Database,
  Download,
  FileUp,
  Github,
  GraduationCap,
  ListChecks,
  Loader2,
  Mail,
  RefreshCw,
  Save,
  Upload,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
type SourcePanelId =
  | "google_calendar"
  | "gmail"
  | "notion"
  | "canvas"
  | "manual"
  | "todoist"
  | "google_tasks"
  | "microsoft_todo"
  | "ticktick"
  | "things_3"
  | "linear"
  | "github"
type ActionPayload = {
  error?: string
  details?: string
  needsAuthorization?: boolean
  needsDatabaseSelection?: boolean
}
type ConnectorState = SourceConnectorStatus | "manual" | "developing" | "refresh_issue"
type ConnectorDefinition = {
  id: SourcePanelId
  title: string
  group: "configured" | "manual" | "developing"
  icon: LucideIcon
  summary: string
}

const CONNECTOR_DEFINITIONS: ConnectorDefinition[] = [
  {
    id: "google_calendar",
    title: "Google Calendar",
    group: "configured",
    icon: CalendarDays,
    summary: "Mirror calendar commitments for planning constraints, conflicts, and task-block sync.",
  },
  {
    id: "gmail",
    title: "Gmail",
    group: "configured",
    icon: Mail,
    summary: "Scan recent mail for planning context, replies, logistics, and deadlines.",
  },
  {
    id: "notion",
    title: "Notion",
    group: "configured",
    icon: BookOpen,
    summary: "Import tasks from the authoritative Notion tasks database.",
  },
  {
    id: "canvas",
    title: "Canvas",
    group: "configured",
    icon: GraduationCap,
    summary: "Import planner items from Canvas and sync completed planner items back.",
  },
  {
    id: "manual",
    title: "Manual context",
    group: "manual",
    icon: FileUp,
    summary: "Upload or paste one-off source material.",
  },
  {
    id: "todoist",
    title: "Todoist",
    group: "developing",
    icon: ListChecks,
    summary: "Task sync is being developed.",
  },
  {
    id: "google_tasks",
    title: "Google Tasks",
    group: "developing",
    icon: CheckCircle2,
    summary: "Google task list sync is being developed.",
  },
  {
    id: "microsoft_todo",
    title: "Microsoft To Do",
    group: "developing",
    icon: CheckCircle2,
    summary: "Microsoft task sync is being developed.",
  },
  {
    id: "ticktick",
    title: "TickTick",
    group: "developing",
    icon: ListChecks,
    summary: "TickTick task sync is being developed.",
  },
  {
    id: "things_3",
    title: "Things 3",
    group: "developing",
    icon: ListChecks,
    summary: "Local Things 3 task sync is being developed.",
  },
  {
    id: "linear",
    title: "Linear",
    group: "developing",
    icon: ListChecks,
    summary: "Issue context sync is being developed.",
  },
  {
    id: "github",
    title: "GitHub",
    group: "developing",
    icon: Github,
    summary: "Repository and issue context sync is being developed.",
  },
]

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
    selectedSourceId: null,
    selectedSourceName: null,
    detail:
      id === "notion"
        ? "Authorize a Notion workspace before importing scheduling context."
        : id === "canvas"
          ? "Connect Canvas with a base URL and personal access token."
          : id === "google_calendar"
            ? "Authorize Google Calendar read access before planning from current commitments."
            : "Authorize Google with Gmail read-only access before scanning mail context.",
  }
}

function formatCapturedAt(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function connectorStatusLabel(state: ConnectorState) {
  if (state === "auth_needed") return "not connected"
  if (state === "missing_config") return "setup needed"
  if (state === "refresh_issue") return "refresh issue"
  if (state === "developing") return "developing"
  return state
}

function connectorStatusDotTone(state: ConnectorState) {
  if (state === "connected" || state === "ready" || state === "manual") {
    return "bg-emerald-300/90 shadow-[0_0_6px_rgba(110,231,183,0.5)]"
  }

  if (state === "failed" || state === "missing_config" || state === "refresh_issue") {
    return "bg-destructive"
  }

  if (state === "developing") {
    return "border border-muted-foreground/40 bg-transparent"
  }

  return "bg-copper/85"
}

function ConnectorStatusMark({
  state,
  className,
}: {
  state: ConnectorState
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground",
        className,
      )}
    >
      <span
        className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", connectorStatusDotTone(state))}
        aria-hidden="true"
      />
      {connectorStatusLabel(state)}
    </span>
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

function ConnectorRow({
  connector,
  state,
  active,
  onSelect,
}: {
  connector: ConnectorDefinition
  state: ConnectorState
  active: boolean
  onSelect: () => void
}) {
  const Icon = connector.icon

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group flex w-full min-w-0 items-center gap-3 border-b border-rule/70 py-2.5 pl-3 pr-2 text-left transition-colors",
        active ? "bg-secondary/25" : "hover:bg-secondary/15",
      )}
      aria-pressed={active}
    >
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0 transition-colors",
          active ? "text-copper" : "text-muted-foreground/70 group-hover:text-foreground/80",
        )}
        aria-hidden="true"
        strokeWidth={1.75}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px] font-medium transition-colors",
          active ? "text-foreground" : "text-foreground/85",
        )}
      >
        {connector.title}
      </span>
      <ConnectorStatusMark state={state} />
    </button>
  )
}

function ConnectorGroup({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col">
      <h3 className="border-b border-rule/70 pb-2 pl-3 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
        {title}
      </h3>
      {children}
    </div>
  )
}

function FailedSourceAlert({ sources }: { sources: SourceSnapshotSummary[] }) {
  if (sources.length === 0) {
    return null
  }

  return (
    <Alert variant="destructive" className="min-w-0 rounded-sm border-destructive/40 bg-destructive/5 text-[12px]">
      <AlertTriangle aria-hidden="true" />
      <AlertTitle className="min-w-0 text-[12px]">
        {sources.length} refresh issue{sources.length === 1 ? "" : "s"}
      </AlertTitle>
      <AlertDescription className="min-w-0 text-[12px]">
        <div className="flex min-w-0 flex-col gap-2">
          {sources.map((source) => (
            <div key={source.id} className="min-w-0 rounded-sm border border-destructive/25 px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium capitalize text-foreground">{source.source.replace("_", " ")}</span>
                <span className="num shrink-0 text-[10px] uppercase text-destructive/80">{formatCapturedAt(source.capturedAt)}</span>
              </div>
              <p className="mt-1 max-w-full leading-5 text-destructive/90 [overflow-wrap:anywhere]">{source.summary}</p>
            </div>
          ))}
        </div>
      </AlertDescription>
    </Alert>
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

function DetailNote({ message }: { message: string }) {
  if (!message) {
    return null
  }

  return (
    <div className="rounded-sm border border-rule bg-secondary/15 px-3 py-2 text-[12px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
      {message}
    </div>
  )
}

function DetailHeader({
  connector,
  state,
}: {
  connector: ConnectorDefinition
  state: ConnectorState
}) {
  const Icon = connector.icon

  return (
    <div className="flex flex-col gap-2 border-b border-rule pb-4">
      <div className="flex items-center gap-2.5">
        <Icon className="h-4 w-4 shrink-0 text-copper" aria-hidden="true" strokeWidth={1.75} />
        <h2 className="truncate text-[15px] font-semibold leading-none text-foreground">{connector.title}</h2>
        <ConnectorStatusMark state={state} className="ml-auto" />
      </div>
      <p className="max-w-[64ch] text-[12px] leading-5 text-muted-foreground">{connector.summary}</p>
    </div>
  )
}

function InfoLine({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 border-b border-rule py-2 last:border-b-0">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-[12px] font-medium text-foreground">{value || "—"}</span>
    </div>
  )
}

function LedgerStrip({
  items,
}: {
  items: Array<{ label: string; value: number; tone?: "default" | "alert" }>
}) {
  return (
    <div className="flex min-w-0 items-stretch divide-x divide-rule/60 border-t border-rule/70 pt-3">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-1 items-baseline gap-2 px-3 first:pl-0 last:pr-0">
          <span className="num text-[14px] font-semibold leading-none tabular-nums text-foreground">
            {item.value}
          </span>
          <span
            className={cn(
              "truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground",
              item.tone === "alert" && item.value > 0 && "text-destructive",
            )}
          >
            {item.label}
          </span>
        </div>
      ))}
    </div>
  )
}

function DevelopingDetail({ connector, state }: { connector: ConnectorDefinition; state: ConnectorState }) {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <DetailHeader connector={connector} state={state} />
      <div className="rounded-sm border border-rule bg-secondary/10 px-4 py-4">
        <h3 className="text-[13px] font-medium text-foreground">This integration is being developed</h3>
        <p className="mt-2 max-w-[58ch] text-[12px] leading-5 text-muted-foreground">
          JARVIS will surface this connector here once sync, permissions, and source refresh handling are ready.
        </p>
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
  const googleCalendarConnector = getConnector(sourceConnectors, "google_calendar")
  const gmailConnector = getConnector(sourceConnectors, "gmail")
  const canvasConnector = getConnector(sourceConnectors, "canvas")
  const googleCalendarConfigMissing = googleCalendarConnector.status === "missing_config"
  const gmailConfigMissing = gmailConnector.status === "missing_config"
  const [selectedId, setSelectedId] = useState<SourcePanelId>("google_calendar")
  const [pasteText, setPasteText] = useState("")
  const [notionDatabaseInput, setNotionDatabaseInput] = useState(notionConnector.selectedSourceId ?? "")
  const [canvasBaseUrlInput, setCanvasBaseUrlInput] = useState(canvasConnector.selectedSourceId ?? "")
  const [canvasTokenInput, setCanvasTokenInput] = useState("")
  const [status, setStatus] = useState<ActionStatus>("idle")
  const [errorMessage, setErrorMessage] = useState("")
  const [dedupeStatus, setDedupeStatus] = useState<"idle" | "busy" | "done" | "error">("idle")
  const [dedupeSummary, setDedupeSummary] = useState("")
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pendingCount = sourceCandidates.filter((candidate) => candidate.status === "pending").length
  const failedSources = sources.filter((source) => source.freshness === "failed")
  const busy = status === "busy"

  const selectedConnector = CONNECTOR_DEFINITIONS.find((connector) => connector.id === selectedId) ?? CONNECTOR_DEFINITIONS[0]
  const failedSourcesByKind = useMemo(() => {
    return failedSources.reduce<Record<string, SourceSnapshotSummary[]>>((groups, source) => {
      groups[source.source] = [...(groups[source.source] ?? []), source]
      return groups
    }, {})
  }, [failedSources])

  useEffect(() => {
    setNotionDatabaseInput(notionConnector.selectedSourceId ?? "")
  }, [notionConnector.selectedSourceId])

  useEffect(() => {
    setCanvasBaseUrlInput(canvasConnector.selectedSourceId ?? "")
  }, [canvasConnector.selectedSourceId])

  function stateForConnector(connector: ConnectorDefinition): ConnectorState {
    if (connector.id === "manual") {
      return "manual"
    }

    if (connector.group === "developing") {
      return "developing"
    }

    if (connector.id === "google_calendar") {
      if (
        (googleCalendarConnector.status === "ready" || googleCalendarConnector.status === "connected") &&
        failedSourcesByKind.google_calendar?.length
      ) {
        return "refresh_issue"
      }

      return googleCalendarConnector.status
    }

    if (connector.id === "gmail") {
      if (
        (gmailConnector.status === "ready" || gmailConnector.status === "connected") &&
        failedSourcesByKind.gmail?.length
      ) {
        return "refresh_issue"
      }

      return gmailConnector.status
    }

    if (connector.id === "canvas") {
      if (
        (canvasConnector.status === "ready" || canvasConnector.status === "connected") &&
        failedSourcesByKind.canvas?.length
      ) {
        return "refresh_issue"
      }

      return canvasConnector.status
    }

    if (
      (notionConnector.status === "ready" || notionConnector.status === "connected") &&
      failedSourcesByKind.notion?.length
    ) {
      return "refresh_issue"
    }

    return notionConnector.status
  }

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

  async function handleDedupe() {
    setDedupeStatus("busy")
    setDedupeSummary("")
    try {
      const response = await fetch("/api/sources/candidates/dedupe", { method: "POST" })
      const payload = (await response.json().catch(() => null)) as
        | { success?: true; removedCandidates?: number; removedTasks?: number; removedEvents?: number; details?: string }
        | null

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.details || "Dedupe failed.")
      }

      const c = payload.removedCandidates ?? 0
      const t = payload.removedTasks ?? 0
      const e = payload.removedEvents ?? 0
      setDedupeSummary(
        c === 0 && t === 0 && e === 0
          ? "Nothing to dedupe."
          : `Removed ${c} duplicate candidate${c === 1 ? "" : "s"}, ${t} task${t === 1 ? "" : "s"}, ${e} event${e === 1 ? "" : "s"}.`,
      )
      setDedupeStatus("done")
      await onSourcesChanged()
    } catch (error) {
      setDedupeStatus("error")
      setDedupeSummary(error instanceof Error ? error.message : "Dedupe failed.")
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

  async function handleGoogleCalendarSync() {
    await runAction(async () => {
      const response = await fetch("/api/google-calendar/events", {
        method: "POST",
      })
      const payload = (await response.json().catch(() => null)) as ActionPayload | null

      if (!response.ok || !payload) {
        throw new Error(getPayloadMessage(payload, "Google Calendar refresh failed."))
      }
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

  async function handleCanvasConnect() {
    const baseUrl = canvasBaseUrlInput.trim()
    const accessToken = canvasTokenInput.trim()

    if (!baseUrl || !accessToken) {
      setErrorMessage("Enter the Canvas base URL and access token.")
      setStatus("error")
      return
    }

    await runAction(async () => {
      const response = await fetch("/api/integrations/canvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, accessToken }),
      })

      await readJson(response, "Canvas connection failed.")
      setCanvasTokenInput("")
    })
  }

  async function handleCanvasImport() {
    await runAction(async () => {
      const response = await fetch("/api/integrations/canvas/import", {
        method: "POST",
      })
      const payload = (await response.json().catch(() => null)) as ActionPayload | null

      if (!response.ok || !payload) {
        throw new Error(getPayloadMessage(payload, "Canvas import failed."))
      }
    })
  }

  function renderDetail() {
    const state = stateForConnector(selectedConnector)

    if (selectedConnector.group === "developing") {
      return <DevelopingDetail connector={selectedConnector} state={state} />
    }

    if (selectedConnector.id === "manual") {
      return (
        <div className="flex min-w-0 flex-col gap-5">
          <DetailHeader connector={selectedConnector} state={state} />
          <div className="flex flex-col gap-3">
            <div>
              <ActionButton icon={FileUp} label="Upload source" onClick={() => fileInputRef.current?.click()} disabled={busy} />
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
                    rows={5}
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
        </div>
      )
    }

    if (selectedConnector.id === "google_calendar") {
      return (
        <div className="flex min-w-0 flex-col gap-5">
          <DetailHeader connector={selectedConnector} state={state} />
          <FailedSourceAlert sources={failedSourcesByKind.google_calendar ?? []} />
          <DetailNote message={googleCalendarConnector.detail} />
          <div className="flex flex-wrap gap-2">
            <ActionButton
              icon={googleCalendarConnector.canRun ? RefreshCw : CalendarDays}
              label={
                googleCalendarConnector.canRun
                  ? "Refresh Calendar"
                  : googleCalendarConnector.account
                    ? "Reconnect Google"
                    : "Authorize Google"
              }
              onClick={googleCalendarConnector.canRun ? handleGoogleCalendarSync : handleGoogleAuthorize}
              disabled={busy || googleCalendarConfigMissing}
            />
          </div>
          <div className="flex flex-col">
            <InfoLine label="Account" value={googleCalendarConnector.account} />
            <InfoLine label="Status" value={connectorStatusLabel(state)} />
            <InfoLine
              label="Calendar"
              value={googleCalendarConnector.selectedSourceId ?? (googleCalendarConnector.canRun ? "primary" : null)}
            />
          </div>
        </div>
      )
    }

    if (selectedConnector.id === "gmail") {
      return (
        <div className="flex min-w-0 flex-col gap-5">
          <DetailHeader connector={selectedConnector} state={state} />
          <FailedSourceAlert sources={failedSourcesByKind.gmail ?? []} />
          <DetailNote message={gmailConnector.detail} />
          <div className="flex flex-wrap gap-2">
            <ActionButton
              icon={gmailConnector.canRun ? RefreshCw : Mail}
              label={
                gmailConnector.canRun
                  ? "Scan Gmail"
                  : gmailConnector.account
                    ? "Reconnect Google"
                    : "Authorize Gmail"
              }
              onClick={gmailConnector.canRun ? handleGmailScan : handleGoogleAuthorize}
              disabled={busy || gmailConfigMissing}
            />
          </div>
          <div className="flex flex-col">
            <InfoLine label="Account" value={gmailConnector.account} />
            <InfoLine label="Status" value={connectorStatusLabel(state)} />
            <InfoLine label="Review items" value={pendingCount} />
          </div>
        </div>
      )
    }

    if (selectedConnector.id === "canvas") {
      return (
        <div className="flex min-w-0 flex-col gap-5">
          <DetailHeader connector={selectedConnector} state={state} />
          <FailedSourceAlert sources={failedSourcesByKind.canvas ?? []} />
          <div className="flex flex-wrap gap-2">
            <ActionButton
              icon={GraduationCap}
              label={canvasConnector.status === "ready" || canvasConnector.status === "connected" ? "Update token" : "Connect Canvas"}
              onClick={handleCanvasConnect}
              disabled={busy || canvasBaseUrlInput.trim().length === 0 || canvasTokenInput.trim().length === 0}
            />
            <ActionButton
              icon={RefreshCw}
              label="Import Canvas"
              onClick={handleCanvasImport}
              disabled={busy || !canvasConnector.canRun}
            />
            <ActionButton
              icon={Download}
              label="Reader extension"
              onClick={() => {
                window.location.href = "/dashboard/canvas-extension"
              }}
              disabled={busy}
            />
          </div>
          <FieldGroup className="gap-3">
            <Field className="gap-2">
              <FieldLabel className="text-[12px]">Canvas URL</FieldLabel>
              <InputGroup className="min-w-0 rounded-sm border-rule bg-secondary/20">
                <InputGroupInput
                  value={canvasBaseUrlInput}
                  onChange={(event) => setCanvasBaseUrlInput(event.target.value)}
                  placeholder="https://school.instructure.com"
                  disabled={busy}
                  className="min-w-0 text-[12px]"
                />
              </InputGroup>
            </Field>
            <Field className="gap-2">
              <FieldLabel className="text-[12px]">Access Token</FieldLabel>
              <InputGroup className="min-w-0 rounded-sm border-rule bg-secondary/20">
                <InputGroupInput
                  value={canvasTokenInput}
                  onChange={(event) => setCanvasTokenInput(event.target.value)}
                  placeholder="Paste token from Canvas settings"
                  type="password"
                  disabled={busy}
                  className="min-w-0 text-[12px]"
                />
              </InputGroup>
              <FieldDescription className="text-[11px]">
                In Canvas, use Settings → New Access Token with purpose JARVIS Canvas pilot.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <div className="rounded-sm border border-rule px-3">
            <InfoLine label="Account" value={canvasConnector.account} />
            <InfoLine label="Canvas host" value={canvasConnector.selectedSourceName} />
            <InfoLine label="Status" value={connectorStatusLabel(state)} />
          </div>
        </div>
      )
    }

    return (
      <div className="flex min-w-0 flex-col gap-5">
        <DetailHeader connector={selectedConnector} state={state} />
        <FailedSourceAlert sources={failedSourcesByKind.notion ?? []} />
        <div className="flex flex-wrap gap-2">
          <ActionButton
            icon={BookOpen}
            label={notionConnector.status === "connected" ? "Reconnect workspace" : "Connect workspace"}
            onClick={handleNotionConnect}
            disabled={busy}
          />
          <ActionButton icon={CalendarDays} label="Import Notion" onClick={handleNotionImport} disabled={busy} />
        </div>
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
        <div className="rounded-sm border border-rule px-3">
          <InfoLine label="Workspace" value={notionConnector.account} />
          <InfoLine label="Selected database" value={notionConnector.selectedSourceName} />
          <InfoLine label="Status" value={connectorStatusLabel(state)} />
        </div>
      </div>
    )
  }

  return (
    <section className="grid min-h-[calc(100vh-6rem)] min-w-0 grid-cols-1 gap-0 overflow-hidden rounded-sm border border-rule md:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col border-b border-rule bg-background md:border-b-0 md:border-r">
        <header className="flex flex-col gap-2 border-b border-rule px-3 py-4">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 shrink-0 text-copper" aria-hidden="true" strokeWidth={1.75} />
            <h2 className="truncate text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground">
              Connectors
            </h2>
            {busy ? (
              <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin text-copper" aria-hidden="true" />
                Working
              </span>
            ) : null}
          </div>
          <p className="max-w-[40ch] text-[12px] leading-5 text-muted-foreground">
            Choose a source to configure.
          </p>
        </header>

        <ConnectorGroup title="Configured">
          {CONNECTOR_DEFINITIONS.filter((connector) => connector.group === "configured").map((connector) => (
            <ConnectorRow
              key={connector.id}
              connector={connector}
              state={stateForConnector(connector)}
              active={selectedId === connector.id}
              onSelect={() => setSelectedId(connector.id)}
            />
          ))}
        </ConnectorGroup>

        <ConnectorGroup title="Manual">
          {CONNECTOR_DEFINITIONS.filter((connector) => connector.group === "manual").map((connector) => (
            <ConnectorRow
              key={connector.id}
              connector={connector}
              state={stateForConnector(connector)}
              active={selectedId === connector.id}
              onSelect={() => setSelectedId(connector.id)}
            />
          ))}
        </ConnectorGroup>

        <ConnectorGroup title="In development">
          {CONNECTOR_DEFINITIONS.filter((connector) => connector.group === "developing").map((connector) => (
            <ConnectorRow
              key={connector.id}
              connector={connector}
              state={stateForConnector(connector)}
              active={selectedId === connector.id}
              onSelect={() => setSelectedId(connector.id)}
            />
          ))}
        </ConnectorGroup>
      </div>

      <div className="min-w-0 overflow-y-auto bg-secondary/5 px-5 py-5">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
          {renderDetail()}
          <InlineError message={errorMessage} />
          <LedgerStrip
            items={[
              { label: "Snapshots", value: sources.length },
              { label: "Files", value: sourceFiles.length },
              { label: "Review", value: pendingCount },
              { label: "Failed", value: failedSources.length, tone: "alert" },
            ]}
          />
          <div className="flex flex-col gap-2 rounded-sm border border-rule bg-secondary/15 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-foreground">Dedupe imports</p>
                <p className="text-[11px] leading-4 text-muted-foreground">
                  Collapse duplicate candidates and tasks that share kind, title, due date, and course. Keeps the
                  oldest approved row.
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void handleDedupe()}
                disabled={dedupeStatus === "busy"}
                className="h-7 gap-1.5 rounded-sm px-2 text-[11px] font-medium"
              >
                {dedupeStatus === "busy" ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="h-3 w-3" aria-hidden="true" />
                )}
                {dedupeStatus === "busy" ? "Dedupe-ing" : "Dedupe now"}
              </Button>
            </div>
            {dedupeSummary ? (
              <p
                className={`text-[11px] leading-4 ${dedupeStatus === "error" ? "text-destructive" : "text-muted-foreground"}`}
              >
                {dedupeSummary}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
