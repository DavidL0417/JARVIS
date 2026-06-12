"use client"

import { AlertTriangle } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type {
  SourceConnector,
  SourceConnectorId,
  SourceConnectorStatus,
  SourceSnapshotSummary,
} from "@/types"

export type ActionStatus = "idle" | "busy" | "error"
export type CalDavSetupMode = "apple" | "custom"
export type SourcePanelId =
  | "google_calendar"
  | "caldav"
  | "outlook_calendar"
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
export type ActionPayload = {
  error?: string
  details?: string
  needsAuthorization?: boolean
  needsDatabaseSelection?: boolean
}
export type ConnectorState = SourceConnectorStatus | "manual" | "developing" | "refresh_issue" | "disabled"
export type ConnectorDefinition = {
  id: SourcePanelId
  title: string
  group: "calendar" | "tasks_courses" | "work_context" | "files" | "developing"
  icon: LucideIcon
  summary: string
}

export function getPayloadMessage(payload: ActionPayload | null, fallback: string) {
  return payload?.details || payload?.error || fallback
}

export function getConnector(connectors: SourceConnector[], id: SourceConnectorId): SourceConnector {
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
        : id === "canvas"
          ? "Connect Canvas with a base URL and personal access token."
          : id === "caldav"
            ? "Connect Apple Calendar with your Apple ID email and app-specific password."
          : id === "google_calendar"
            ? "Authorize Google Calendar read access before planning from current commitments."
            : "Authorize Google with Gmail read-only access before scanning mail context.",
  }
}

export function formatCapturedAt(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function connectorStatusLabel(state: ConnectorState) {
  if (state === "disabled") return "off"
  if (state === "auth_needed") return "not connected"
  if (state === "missing_config") return "setup needed"
  if (state === "refresh_issue") return "refresh issue"
  if (state === "developing") return "developing"
  return state
}

export function connectorStatusDotTone(state: ConnectorState) {
  if (state === "connected" || state === "ready" || state === "manual") {
    return "bg-emerald-300/90 shadow-[0_0_6px_rgba(110,231,183,0.5)]"
  }

  if (state === "failed" || state === "missing_config" || state === "refresh_issue") {
    return "bg-destructive"
  }

  if (state === "developing" || state === "disabled") {
    return "border border-muted-foreground/40 bg-transparent"
  }

  return "bg-copper/85"
}

export function ConnectorStatusMark({ state, className }: { state: ConnectorState; className?: string }) {
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

export function ActionButton({
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

export function FailedSourceAlert({ sources }: { sources: SourceSnapshotSummary[] }) {
  if (sources.length === 0) {
    return null
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" strokeWidth={1.75} aria-hidden="true" />
        <span className="eyebrow text-destructive">
          {sources.length} refresh issue{sources.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="flex min-w-0 flex-col">
        {sources.map((source) => (
          <div key={source.id} className="min-w-0 border-b border-rule/50 py-2 last:border-b-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium capitalize text-foreground">{source.source.replace("_", " ")}</span>
              <span className="num shrink-0 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                {formatCapturedAt(source.capturedAt)}
              </span>
            </div>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">{source.summary}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export function InlineError({ message }: { message: string }) {
  if (!message) {
    return null
  }

  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" strokeWidth={1.75} aria-hidden="true" />
      <div className="min-w-0">
        <p className="eyebrow text-destructive">Action failed</p>
        <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">{message}</p>
      </div>
    </div>
  )
}

export function DetailNote({ message }: { message: string }) {
  if (!message) {
    return null
  }

  return (
    <p className="text-[12px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">{message}</p>
  )
}

export function DetailHeader({
  connector,
  state,
  sourceConnector,
  onEnabledChange,
  disabled,
}: {
  connector: ConnectorDefinition
  state: ConnectorState
  sourceConnector?: SourceConnector
  onEnabledChange?: (enabled: boolean) => void
  disabled?: boolean
}) {
  const Icon = connector.icon
  const showSwitch = Boolean(sourceConnector && onEnabledChange)

  return (
    <div className="flex flex-col gap-2 border-b border-rule pb-4">
      <div className="flex items-center gap-2.5">
        <Icon className="h-4 w-4 shrink-0 text-copper" aria-hidden="true" strokeWidth={1.75} />
        <h2 className="truncate text-[15px] font-semibold leading-none text-foreground">{connector.title}</h2>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {showSwitch ? (
            <Switch
              checked={sourceConnector?.enabled ?? true}
              onCheckedChange={onEnabledChange}
              disabled={disabled}
              aria-label={`${sourceConnector?.enabled ? "Turn off" : "Turn on"} ${connector.title}`}
              className="scale-75"
            />
          ) : null}
          <ConnectorStatusMark state={state} />
        </div>
      </div>
      <p className="max-w-[64ch] text-[12px] leading-5 text-muted-foreground">{connector.summary}</p>
    </div>
  )
}

export function InfoLine({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 border-b border-rule py-2 last:border-b-0">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-[12px] font-medium text-foreground">{value || "—"}</span>
    </div>
  )
}

export function LedgerStrip({
  items,
}: {
  items: Array<{ label: string; value: number; tone?: "default" | "alert" }>
}) {
  return (
    <div className="flex min-w-0 items-stretch divide-x divide-rule/60 border-t border-rule/70 pt-3">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-1 items-baseline gap-2 px-3 first:pl-0 last:pr-0">
          <span className="num text-[14px] font-semibold leading-none tabular-nums text-foreground">{item.value}</span>
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

export function DevelopingDetail({ connector, state }: { connector: ConnectorDefinition; state: ConnectorState }) {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <DetailHeader connector={connector} state={state} />
      <div className="flex flex-col gap-1">
        <h3 className="text-[13px] font-medium text-foreground">This integration is being developed</h3>
        <p className="max-w-[58ch] text-[12px] leading-5 text-muted-foreground">
          JARVIS will surface this connector here once sync, permissions, and source refresh handling are ready.
        </p>
      </div>
    </div>
  )
}
