"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowUpRight,
  BookOpen,
  Cable,
  CalendarDays,
  ChevronDown,
  FileUp,
  GraduationCap,
  KeyRound,
  Loader2,
  Mail,
  RefreshCw,
  Save,
  Upload,
} from "lucide-react"

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
import {
  APPLE_CALDAV_SERVER_URL,
  getCalDavServerDisplayName,
  isAppleCalDavServerUrl,
} from "@/lib/caldav/constants"
import { startGoogleSourceAuthorizationRedirect } from "@/lib/supabase/auth-actions"
import { cn } from "@/lib/utils"
import {
  ActionButton,
  connectorStatusLabel,
  ConnectorStatusMark,
  DetailHeader,
  DetailNote,
  DevelopingDetail,
  FailedSourceAlert,
  getConnector,
  getPayloadMessage,
  InfoLine,
  InlineError,
  LedgerStrip,
} from "@/components/dashboard/sources/shared"
import type {
  ActionPayload,
  ActionStatus,
  CalDavSetupMode,
  ConnectorDefinition,
  ConnectorState,
  SourcePanelId,
} from "@/components/dashboard/sources/shared"
import {
  CONNECTOR_DEFINITIONS,
  ConnectorGroup,
  ConnectorRow,
} from "@/components/dashboard/sources/connector-list"
import type {
  SourceCandidate,
  SourceConnector,
  SourceConnectorId,
  SourceFileSummary,
  SourceSnapshotSummary,
} from "@/types"

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
  const calDavConnector = getConnector(sourceConnectors, "caldav")
  const gmailConnector = getConnector(sourceConnectors, "gmail")
  const canvasConnector = getConnector(sourceConnectors, "canvas")
  const googleCalendarConfigMissing = googleCalendarConnector.status === "missing_config"
  const gmailConfigMissing = gmailConnector.status === "missing_config"
  const [calDavMode, setCalDavMode] = useState<CalDavSetupMode>(
    !calDavConnector.selectedSourceId || isAppleCalDavServerUrl(calDavConnector.selectedSourceId) ? "apple" : "custom",
  )
  const [calDavServerUrlInput, setCalDavServerUrlInput] = useState(calDavConnector.selectedSourceId ?? APPLE_CALDAV_SERVER_URL)
  const [calDavUsernameInput, setCalDavUsernameInput] = useState(calDavConnector.account ?? "")
  const [calDavPasswordInput, setCalDavPasswordInput] = useState("")
  const [selectedId, setSelectedId] = useState<SourcePanelId>("google_calendar")
  const [pasteText, setPasteText] = useState("")
  const [notionDatabaseInput, setNotionDatabaseInput] = useState(notionConnector.selectedSourceId ?? "")
  const [canvasBaseUrlInput, setCanvasBaseUrlInput] = useState(canvasConnector.selectedSourceId ?? "")
  const [canvasTokenInput, setCanvasTokenInput] = useState("")
  const [showCanvasToken, setShowCanvasToken] = useState(
    canvasConnector.status === "connected" || canvasConnector.status === "ready",
  )
  const [status, setStatus] = useState<ActionStatus>("idle")
  const [errorMessage, setErrorMessage] = useState("")
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pendingCount = sourceCandidates.filter((candidate) => candidate.status === "pending").length
  const busy = status === "busy"
  const activeFailedSourceIds = new Set(
    sourceConnectors
      .filter((connector) => connector.status === "failed")
      .map((connector) => connector.id),
  )
  const failedSources = sources.filter(
    (source) => source.freshness === "failed" && activeFailedSourceIds.has(source.source as SourceConnectorId),
  )

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

  useEffect(() => {
    const serverUrl = calDavConnector.selectedSourceId ?? APPLE_CALDAV_SERVER_URL
    setCalDavServerUrlInput(serverUrl)
    setCalDavMode(!calDavConnector.selectedSourceId || isAppleCalDavServerUrl(serverUrl) ? "apple" : "custom")
  }, [calDavConnector.selectedSourceId])

  useEffect(() => {
    setCalDavUsernameInput(calDavConnector.account ?? "")
  }, [calDavConnector.account])

  function stateForConnector(connector: ConnectorDefinition): ConnectorState {
    if (connector.id === "manual") {
      return "manual"
    }

    if (connector.group === "developing" || connector.id === "outlook_calendar" || connector.id === "linear" || connector.id === "github") {
      return "developing"
    }

    if (connector.id === "google_calendar") {
      if (!googleCalendarConnector.enabled) {
        return "disabled"
      }

      if (googleCalendarConnector.status === "failed") {
        return "refresh_issue"
      }

      return googleCalendarConnector.status
    }

    if (connector.id === "caldav") {
      if (!calDavConnector.enabled) {
        return "disabled"
      }

      if (calDavConnector.status === "failed") {
        return "refresh_issue"
      }

      return calDavConnector.status
    }

    if (connector.id === "gmail") {
      if (!gmailConnector.enabled) {
        return "disabled"
      }

      if (gmailConnector.status === "failed") {
        return "refresh_issue"
      }

      return gmailConnector.status
    }

    if (connector.id === "canvas") {
      if (!canvasConnector.enabled) {
        return "disabled"
      }

      // The browser-extension Canvas Reader is the primary path, so an unused or
      // failed legacy API-token connection reads as "not connected" here rather than
      // a hard failure. The real token status is still shown inside its own section.
      if (canvasConnector.status === "failed") {
        return "auth_needed"
      }

      return canvasConnector.status
    }

    if (!notionConnector.enabled) {
      return "disabled"
    }

    if (notionConnector.status === "failed") {
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
      setErrorMessage("Paste the authoritative Notion tasks source URL or ID.")
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

  async function handleCalDavConnect() {
    const serverUrl = calDavMode === "apple" ? APPLE_CALDAV_SERVER_URL : calDavServerUrlInput.trim()
    const username = calDavUsernameInput.trim()
    const password = calDavPasswordInput.trim()

    if (!username || !password || (calDavMode === "custom" && !serverUrl)) {
      setErrorMessage(
        calDavMode === "apple"
          ? "Enter your Apple ID email and app-specific password."
          : "Enter the CalDAV server URL, username, and app password.",
      )
      setStatus("error")
      return
    }

    await runAction(async () => {
      const response = await fetch("/api/integrations/caldav", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverUrl, username, password }),
      })

      await readJson(response, "CalDAV connection failed.")
      setCalDavPasswordInput("")
    })
  }

  async function handleCalDavImport() {
    await runAction(async () => {
      const response = await fetch("/api/integrations/caldav/import", {
        method: "POST",
      })
      const payload = (await response.json().catch(() => null)) as ActionPayload | null

      if (!response.ok || !payload) {
        throw new Error(getPayloadMessage(payload, "CalDAV refresh failed."))
      }
    })
  }

  async function handleConnectorEnabled(connectorId: SourceConnectorId, enabled: boolean) {
    await runAction(async () => {
      const response = await fetch(`/api/integrations/connectors/${connectorId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      })

      await readJson(response, "Failed to update source setting.")
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

    if (state === "developing") {
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
          <DetailHeader
            connector={selectedConnector}
            state={state}
            sourceConnector={googleCalendarConnector}
            onEnabledChange={(enabled) => void handleConnectorEnabled("google_calendar", enabled)}
            disabled={busy}
          />
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
              disabled={busy || googleCalendarConfigMissing || !googleCalendarConnector.enabled}
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

    if (selectedConnector.id === "caldav") {
      const isConnected = calDavConnector.status === "ready" || calDavConnector.status === "connected"
      const calDavServerName =
        getCalDavServerDisplayName(calDavConnector.selectedSourceId) ??
        calDavConnector.selectedSourceName ??
        (calDavMode === "apple" ? "Apple Calendar" : null)

      return (
        <div className="flex min-w-0 flex-col gap-5">
          <DetailHeader
            connector={selectedConnector}
            state={state}
            sourceConnector={calDavConnector}
            onEnabledChange={(enabled) => void handleConnectorEnabled("caldav", enabled)}
            disabled={busy}
          />
          <FailedSourceAlert sources={failedSourcesByKind.caldav ?? []} />
          <DetailNote message={calDavConnector.detail} />
          <div className="inline-flex w-fit rounded-sm border border-rule bg-secondary/10 p-0.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={calDavMode === "apple"}
              className={cn(
                "h-8 rounded-[2px] px-3 text-[12px] text-muted-foreground hover:bg-secondary/40 hover:text-foreground",
                calDavMode === "apple" && "bg-secondary/70 text-foreground",
              )}
              onClick={() => {
                setCalDavMode("apple")
                setCalDavServerUrlInput(APPLE_CALDAV_SERVER_URL)
              }}
              disabled={busy}
            >
              Apple
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={calDavMode === "custom"}
              className={cn(
                "h-8 rounded-[2px] px-3 text-[12px] text-muted-foreground hover:bg-secondary/40 hover:text-foreground",
                calDavMode === "custom" && "bg-secondary/70 text-foreground",
              )}
              onClick={() => setCalDavMode("custom")}
              disabled={busy}
            >
              Custom
            </Button>
          </div>
          <FieldGroup className="gap-3">
            {calDavMode === "custom" ? (
              <Field className="gap-2">
                <FieldLabel className="text-[12px]">Server URL</FieldLabel>
                <InputGroup className="min-w-0 rounded-sm border-rule bg-secondary/20">
                  <InputGroupInput
                    value={calDavServerUrlInput}
                    onChange={(event) => setCalDavServerUrlInput(event.target.value)}
                    placeholder="https://caldav.example.com"
                    disabled={busy}
                    className="min-w-0 text-[12px]"
                  />
                </InputGroup>
              </Field>
            ) : null}
            <Field className="gap-2">
              <FieldLabel className="text-[12px]">
                {calDavMode === "apple" ? "Apple ID Email" : "Username"}
              </FieldLabel>
              <InputGroup className="min-w-0 rounded-sm border-rule bg-secondary/20">
                <InputGroupInput
                  value={calDavUsernameInput}
                  onChange={(event) => setCalDavUsernameInput(event.target.value)}
                  placeholder="name@example.com"
                  type={calDavMode === "apple" ? "email" : "text"}
                  disabled={busy}
                  className="min-w-0 text-[12px]"
                />
              </InputGroup>
            </Field>
            <Field className="gap-2">
              <FieldLabel className="text-[12px]">
                {calDavMode === "apple" ? "App-Specific Password" : "App Password"}
              </FieldLabel>
              <InputGroup className="min-w-0 rounded-sm border-rule bg-secondary/20">
                <InputGroupInput
                  value={calDavPasswordInput}
                  onChange={(event) => setCalDavPasswordInput(event.target.value)}
                  placeholder={calDavMode === "apple" ? "xxxx-xxxx-xxxx-xxxx" : "App password"}
                  type="password"
                  disabled={busy}
                  className="min-w-0 text-[12px]"
                />
              </InputGroup>
              <FieldDescription className="text-[11px]">
                Stored privately. CalDAV sync is read-only in this version.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <div className="flex flex-wrap gap-2">
            <ActionButton
              icon={CalendarDays}
              label={
                isConnected
                  ? calDavMode === "apple"
                    ? "Update Apple Calendar"
                    : "Update CalDAV"
                  : calDavMode === "apple"
                    ? "Connect Apple Calendar"
                    : "Connect CalDAV"
              }
              onClick={handleCalDavConnect}
              disabled={
                busy ||
                !calDavConnector.enabled ||
                (calDavMode === "custom" && calDavServerUrlInput.trim().length === 0) ||
                calDavUsernameInput.trim().length === 0 ||
                calDavPasswordInput.trim().length === 0
              }
            />
            <ActionButton
              icon={RefreshCw}
              label={calDavMode === "apple" ? "Refresh Apple Calendar" : "Refresh CalDAV"}
              onClick={handleCalDavImport}
              disabled={busy || !calDavConnector.canRun}
            />
          </div>
          <div className="flex flex-col">
            <InfoLine label="Account" value={calDavConnector.account} />
            <InfoLine label="Provider" value={calDavServerName} />
            <InfoLine label="Status" value={connectorStatusLabel(state)} />
          </div>
        </div>
      )
    }

    if (selectedConnector.id === "gmail") {
      return (
        <div className="flex min-w-0 flex-col gap-5">
          <DetailHeader
            connector={selectedConnector}
            state={state}
            sourceConnector={gmailConnector}
            onEnabledChange={(enabled) => void handleConnectorEnabled("gmail", enabled)}
            disabled={busy}
          />
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
              disabled={busy || gmailConfigMissing || !gmailConnector.enabled}
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
      const tokenConnected = canvasConnector.status === "ready" || canvasConnector.status === "connected"

      return (
        <div className="flex min-w-0 flex-col gap-5">
          <DetailHeader
            connector={selectedConnector}
            state={state}
            sourceConnector={canvasConnector}
            onEnabledChange={(enabled) => void handleConnectorEnabled("canvas", enabled)}
            disabled={busy}
          />
          <FailedSourceAlert sources={failedSourcesByKind.canvas ?? []} />

          {/* Primary path — the browser-extension Canvas Reader */}
          <div className="flex flex-col gap-3.5 rounded-sm border border-rule px-4 py-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-copper/40 bg-background/40 text-copper">
                <GraduationCap className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-[13px] font-semibold text-foreground">Canvas Reader</h3>
                  <span className="rounded-full border border-copper/40 px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.1em] text-copper">
                    Recommended
                  </span>
                </div>
                <p className="mt-1 max-w-[54ch] text-[12px] leading-5 text-muted-foreground">
                  Reads your courses through the browser extension on your signed-in Canvas
                  session — no access token or password needed. Sync a course, skim the
                  content, and import what JARVIS should plan around.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-11">
              <Button
                size="sm"
                onClick={() => {
                  window.location.href = "/dashboard/canvas-extension"
                }}
                className="h-8 gap-1.5 rounded-sm px-3 text-[11px] font-medium"
              >
                Open Canvas Reader
                <ArrowUpRight aria-hidden="true" />
              </Button>
              <span className="text-[11px] text-muted-foreground">
                First time? It walks you through installing the extension.
              </span>
            </div>
          </div>

          {/* Secondary path — legacy personal API token (most SSO/MFA schools can't use it) */}
          <div className="flex min-w-0 flex-col overflow-hidden rounded-sm border border-rule">
            <button
              type="button"
              onClick={() => setShowCanvasToken((value) => !value)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-secondary/15"
              aria-expanded={showCanvasToken}
            >
              <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
              <span className="text-[12px] font-medium text-foreground">Connect with an API token</span>
              <span className="ml-auto inline-flex items-center gap-2.5">
                <ConnectorStatusMark state={canvasConnector.status} />
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                    !showCanvasToken && "-rotate-90",
                  )}
                  aria-hidden="true"
                />
              </span>
            </button>
            {showCanvasToken ? (
              <div className="flex min-w-0 flex-col gap-4 border-t border-rule px-3 py-4">
                <p className="text-[11px] leading-5 text-muted-foreground">
                  For schools that issue personal Canvas API tokens. If your school uses single
                  sign-on or two-factor (most do), use the Canvas Reader above instead.
                </p>
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
                <div className="flex flex-wrap gap-2">
                  <ActionButton
                    icon={GraduationCap}
                    label={tokenConnected ? "Update token" : "Connect Canvas"}
                    onClick={handleCanvasConnect}
                    disabled={busy || canvasBaseUrlInput.trim().length === 0 || canvasTokenInput.trim().length === 0}
                  />
                  <ActionButton
                    icon={RefreshCw}
                    label="Import Canvas"
                    onClick={handleCanvasImport}
                    disabled={busy || !canvasConnector.canRun}
                  />
                </div>
                <div className="flex flex-col">
                  <InfoLine label="Account" value={canvasConnector.account} />
                  <InfoLine label="Canvas host" value={canvasConnector.selectedSourceName} />
                  <InfoLine label="Status" value={connectorStatusLabel(canvasConnector.status)} />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )
    }

    return (
      <div className="flex min-w-0 flex-col gap-5">
        <DetailHeader
          connector={selectedConnector}
          state={state}
          sourceConnector={notionConnector}
          onEnabledChange={(enabled) => void handleConnectorEnabled("notion", enabled)}
          disabled={busy}
        />
        <FailedSourceAlert sources={failedSourcesByKind.notion ?? []} />
        <div className="flex flex-wrap gap-2">
          <ActionButton
            icon={BookOpen}
            label={notionConnector.status === "connected" ? "Reconnect workspace" : "Connect workspace"}
            onClick={handleNotionConnect}
            disabled={busy || !notionConnector.enabled}
          />
          <ActionButton icon={CalendarDays} label="Import Notion" onClick={handleNotionImport} disabled={busy || !notionConnector.enabled} />
        </div>
        <Field className="gap-2">
          <FieldLabel className="text-[12px]">Tasks Source</FieldLabel>
          <InputGroup className="min-w-0 rounded-sm border-rule bg-secondary/20">
            <InputGroupInput
              value={notionDatabaseInput}
              onChange={(event) => setNotionDatabaseInput(event.target.value)}
              placeholder="Paste Notion source URL or ID"
              disabled={busy || !notionConnector.enabled || notionConnector.status === "missing_config"}
              className="min-w-0 text-[12px]"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                onClick={handleSaveNotionDatabase}
                disabled={busy || !notionConnector.enabled || notionDatabaseInput.trim().length === 0 || notionConnector.status === "missing_config"}
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
        <div className="flex flex-col">
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
            <Cable className="h-4 w-4 shrink-0 text-copper" aria-hidden="true" strokeWidth={1.75} />
            <h2 className="truncate text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground">
              Sources
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

        <ConnectorGroup title="Calendar">
          {CONNECTOR_DEFINITIONS.filter((connector) => connector.group === "calendar").map((connector) => (
            <ConnectorRow
              key={connector.id}
              connector={connector}
              state={stateForConnector(connector)}
              active={selectedId === connector.id}
              onSelect={() => setSelectedId(connector.id)}
            />
          ))}
        </ConnectorGroup>

        <ConnectorGroup title="Tasks & Courses">
          {CONNECTOR_DEFINITIONS.filter((connector) => connector.group === "tasks_courses").map((connector) => (
            <ConnectorRow
              key={connector.id}
              connector={connector}
              state={stateForConnector(connector)}
              active={selectedId === connector.id}
              onSelect={() => setSelectedId(connector.id)}
            />
          ))}
        </ConnectorGroup>

        <ConnectorGroup title="Work Context">
          {CONNECTOR_DEFINITIONS.filter((connector) => connector.group === "work_context").map((connector) => (
            <ConnectorRow
              key={connector.id}
              connector={connector}
              state={stateForConnector(connector)}
              active={selectedId === connector.id}
              onSelect={() => setSelectedId(connector.id)}
            />
          ))}
        </ConnectorGroup>

        <ConnectorGroup title="Files">
          {CONNECTOR_DEFINITIONS.filter((connector) => connector.group === "files").map((connector) => (
            <ConnectorRow
              key={connector.id}
              connector={connector}
              state={stateForConnector(connector)}
              active={selectedId === connector.id}
              onSelect={() => setSelectedId(connector.id)}
            />
          ))}
        </ConnectorGroup>

        <ConnectorGroup title="In Development">
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
        </div>
      </div>
    </section>
  )
}
