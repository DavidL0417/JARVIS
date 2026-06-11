"use client"

import Link from "next/link"
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  Folder,
  Globe,
  KeyRound,
  Loader2,
  Play,
  RefreshCw,
  Square,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type {
  CanvasExtensionCommand,
  CanvasExtensionCommandEvent,
  CanvasExtensionNode,
  CanvasExtensionPairingCodeResponse,
  CanvasExtensionSession,
  CanvasExtensionStateResponse,
} from "@/schemas/canvas-extension"

type PairingState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; code: string; expiresAt: string }
  | { status: "error"; message: string }

type TreeNode = CanvasExtensionNode & { children: TreeNode[] }
type ChromeRuntime = {
  runtime?: {
    lastError?: { message?: string }
    sendMessage?: (extensionId: string, message: unknown, callback: (response: unknown) => void) => void
  }
}
type StateError = {
  code: string
  message: string
  details: string
}
type CanvasPagePreviewLink = { url: string; text: string | null }
type CanvasPagePreviewBlock = {
  id: string
  type: "text" | "links" | "mixed"
  title: string | null
  text: string | null
  html: string | null
  links: CanvasPagePreviewLink[]
  order: number
  truncated?: boolean
}
type CanvasPagePreview = {
  html: string
  links: CanvasPagePreviewLink[]
  blocks: CanvasPagePreviewBlock[]
  capturedAt: string
  truncated?: boolean
}
type CanvasPageContent = {
  markdown: string
  apiSource: string | null
  truncated: boolean
  capturedAt: string
  title: string | null
  url: string | null
}

const KNOWN_CANVAS_EXTENSION_IDS = ["aogoejlpbjmfmmdelknoebibkbhlmplc"]
const COMMAND_SETTLE_REFRESH_DELAY_MS = 1200
const COMMAND_LIVE_REFRESH_MS = 1500
const UNSAFE_PREVIEW_HTML_PATTERN = /<\s*(script|iframe|object|embed|form|input|textarea|select|button)\b|on[a-z]+\s*=|srcdoc\s*=|javascript:/i
const CANVAS_ACCENT_TEXT = "text-[#d38a6a]"
const CANVAS_ACCENT_BORDER = "border-[#d38a6a]/45"
const CANVAS_ACCENT_BG = "bg-[#d38a6a]/10"
const CANVAS_ACCENT_HOVER_BG = "hover:bg-[#d38a6a]/20"

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => null)

  if (!response.ok || !payload) {
    const message =
      payload && typeof payload === "object" && "details" in payload && typeof payload.details === "string"
        ? payload.details
        : payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : fallback
    throw new Error(message)
  }

  return payload as T
}

async function readStateResponse(response: Response): Promise<CanvasExtensionStateResponse> {
  const payload = await response.json().catch(() => null)

  if (!response.ok || !payload || payload.success !== true) {
    const error = new Error(
      payload && typeof payload === "object" && typeof payload.details === "string"
        ? payload.details
        : "Failed to load Canvas extension state.",
    ) as Error & { stateError?: StateError }
    error.stateError = {
      code: payload && typeof payload === "object" && typeof payload.errorCode === "string"
        ? payload.errorCode
        : "backend_error",
      message: payload && typeof payload === "object" && typeof payload.error === "string"
        ? payload.error
        : "Failed to load Canvas extension state.",
      details: error.message,
    }
    throw error
  }

  return payload as CanvasExtensionStateResponse
}

function isActiveCommand(command: CanvasExtensionCommand | null) {
  return Boolean(command && ["pending", "running", "cancel_requested"].includes(command.status))
}

function commandTone(command: CanvasExtensionCommand | null) {
  if (!command) return "idle"
  if (command.status === "failed") return "failed"
  if (command.status === "cancel_requested") return "warning"
  if (command.status === "succeeded") return "success"
  if (command.status === "cancelled") return "warning"
  return "running"
}

function commandLabel(command: CanvasExtensionCommand | null) {
  if (!command) return "Idle"
  if (command.type === "discover") return "Discover All Courses"
  if (command.type === "expand_node") return "Expand Canvas Node"
  if (command.type === "capture_url") return "Capture Canvas Page"
  return "Import Selection"
}

function buildTree(nodes: CanvasExtensionNode[]) {
  const byId = new Map<string, TreeNode>()
  const roots: TreeNode[] = []

  for (const node of nodes) byId.set(node.id, { ...node, children: [] })

  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)?.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sortTree = (items: TreeNode[]) => {
    items.sort((left, right) => left.title.localeCompare(right.title))
    for (const item of items) sortTree(item.children)
  }

  sortTree(roots)
  return roots
}

function formatTime(value: string | null | undefined, clientReady: boolean) {
  if (!clientReady) return "..."
  if (!value) return "never"
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })
}

function nodeLevel(node: CanvasExtensionNode) {
  const level = node.metadata.level
  if (level === "course" || level === "tab" || level === "item") return level
  if (node.kind === "course") return "course"
  return node.parentId ? "item" : "tab"
}

function displayUrl(node: CanvasExtensionNode) {
  return typeof node.metadata.actualUrl === "string" ? node.metadata.actualUrl : node.url
}

function pagePreviewFor(node: CanvasExtensionNode): CanvasPagePreview | null {
  const value = node.metadata.pagePreview

  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const preview = value as Record<string, unknown>
  if (typeof preview.html !== "string" || typeof preview.capturedAt !== "string") return null
  if (UNSAFE_PREVIEW_HTML_PATTERN.test(preview.html)) return null
  const rawLinks = Array.isArray(preview.links) ? preview.links : []
  const links = rawLinks.flatMap((link) => {
    if (!link || typeof link !== "object" || Array.isArray(link)) return []
    const record = link as Record<string, unknown>
    return typeof record.url === "string"
      ? [{ url: record.url, text: typeof record.text === "string" ? record.text : null }]
      : []
  })
  const rawBlocks = Array.isArray(preview.blocks) ? preview.blocks : []
  const blocks: CanvasPagePreviewBlock[] = rawBlocks.flatMap((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return []
    const record = block as Record<string, unknown>
    const type: CanvasPagePreviewBlock["type"] | null =
      record.type === "links" || record.type === "mixed" || record.type === "text" ? record.type : null
    if (!type || typeof record.id !== "string" || typeof record.order !== "number") return []
    const blockHtml = typeof record.html === "string" && !UNSAFE_PREVIEW_HTML_PATTERN.test(record.html) ? record.html : null
    const blockLinks = Array.isArray(record.links) ? record.links.flatMap((link) => {
      if (!link || typeof link !== "object" || Array.isArray(link)) return []
      const linkRecord = link as Record<string, unknown>
      return typeof linkRecord.url === "string"
        ? [{ url: linkRecord.url, text: typeof linkRecord.text === "string" ? linkRecord.text : null }]
        : []
    }) : []

    return [{
      id: record.id,
      type,
      title: typeof record.title === "string" ? record.title : null,
      text: typeof record.text === "string" ? record.text : null,
      html: blockHtml,
      links: blockLinks,
      order: record.order,
      truncated: record.truncated === true,
    }]
  }).sort((left, right) => left.order - right.order)

  return {
    html: preview.html,
    links,
    blocks,
    capturedAt: preview.capturedAt,
    truncated: preview.truncated === true,
  }
}

function nodePathLabel(node: CanvasExtensionNode) {
  try {
    const url = new URL(displayUrl(node))
    const courseTrimmed = url.pathname.replace(/^\/courses\/[^/]+\/?/, "")
    const path = courseTrimmed || "home"
    return path.replace(/^\/+/, "").replace(/[-_]/g, " ") || url.hostname
  } catch {
    return node.kind
  }
}

function urlPathLabel(value: string) {
  try {
    const url = new URL(value)
    const courseTrimmed = url.pathname.replace(/^\/courses\/[^/]+\/?/, "")
    return (courseTrimmed || "home").replace(/^\/+/, "").replace(/[-_]/g, " ") || url.hostname
  } catch {
    return value
  }
}

function selectedByParent(node: CanvasExtensionNode) {
  return node.metadata.selectedByParent === true
}

function ancestorByLevel(node: TreeNode | null, nodesById: Map<string, TreeNode>, level: "course" | "tab" | "item") {
  let current = node

  while (current) {
    if (nodeLevel(current) === level) return current
    current = current.parentId ? nodesById.get(current.parentId) ?? null : null
  }

  return null
}

function nodeIcon(node: CanvasExtensionNode) {
  if (node.kind === "course" || nodeLevel(node) === "tab") return Folder
  if (node.kind === "external_link") return Globe
  return FileText
}

function isCaptureableExternalLink(href: string, canvasOrigin: string | undefined | null): boolean {
  try {
    const url = new URL(href)
    if (url.protocol !== "https:" && url.protocol !== "http:") return false
    if (canvasOrigin && url.host.toLowerCase() === new URL(canvasOrigin).host.toLowerCase()) return false
    return true
  } catch {
    return false
  }
}

function statusCopy(input: {
  session: CanvasExtensionSession | null
  activeCommand: CanvasExtensionCommand | null
  lastEvent: CanvasExtensionCommandEvent | null
  error: StateError | null
  loaded: boolean
  clientReady: boolean
}) {
  if (!input.loaded && !input.error) {
    return {
      tone: "idle",
      label: "Loading state",
      detail: "Reading Canvas connector state.",
    }
  }

  if (input.error) {
    if (input.error.code === "extension_offline") {
      return {
        tone: "warning",
        label: "Canvas Reader did not respond",
        detail: input.error.details || input.error.message,
      }
    }

    return {
      tone: input.error.code === "auth_required" ? "warning" : "failed",
      label: input.error.code === "auth_required" ? "Signed out" : "Backend issue",
      detail: input.error.details || input.error.message,
    }
  }

  if (input.activeCommand) {
    const commandDetail =
      input.activeCommand.status === "pending"
        ? "Command queued. Waiting for the Chrome extension to wake up or poll Canvas."
        : input.lastEvent?.message || commandLabel(input.activeCommand)

    return {
      tone: commandTone(input.activeCommand),
      label: input.activeCommand.status === "pending"
        ? "Waiting for Canvas Reader"
        : input.activeCommand.status === "cancel_requested"
          ? "Stopping"
          : input.activeCommand.status === "running"
            ? "Running"
            : input.activeCommand.status,
      detail: commandDetail,
    }
  }

  if (!input.session) {
    return {
      tone: "warning",
      label: "Extension offline",
      detail: "No Canvas Reader heartbeat yet.",
    }
  }

  const recentEvent = input.lastEvent && input.clientReady && Date.now() - new Date(input.lastEvent.createdAt).getTime() < 10 * 60_000
    ? input.lastEvent
    : null
  // MV3 alarm polls land roughly every 60-70s when Chrome throttles the worker,
  // so anything under ~2 polls of silence is normal jitter, not a dead extension.
  const stale = input.clientReady && Date.now() - new Date(input.session.lastSeenAt).getTime() >= 150_000
  return {
    tone: stale ? "warning" : "success",
    label: stale ? "Extension stale" : "Extension live",
    detail: recentEvent?.message || input.session.activeTitle || input.session.activeUrl || input.session.canvasOrigin || "Ready",
  }
}

function IconButton(props: {
  label: string
  children: ReactNode
  disabled?: boolean
  onClick?: () => void
  variant?: "default" | "outline" | "ghost"
  tone?: "default" | "canvas"
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant={props.variant ?? "outline"}
          className={cn(
            "h-9 w-9 rounded-sm",
            props.tone === "canvas" && CANVAS_ACCENT_BORDER,
            props.tone === "canvas" && CANVAS_ACCENT_BG,
            props.tone === "canvas" && CANVAS_ACCENT_TEXT,
            props.tone === "canvas" && CANVAS_ACCENT_HOVER_BG,
          )}
          disabled={props.disabled}
          onClick={props.onClick}
          aria-label={props.label}
        >
          {props.children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-[11px]">{props.label}</TooltipContent>
    </Tooltip>
  )
}

function StatusDot({ tone }: { tone: string }) {
  return (
    <span
      className={cn(
        "h-2 w-2 shrink-0 rounded-full",
        tone === "success" && "bg-green-500",
        tone === "running" && "bg-primary",
        tone === "warning" && "bg-yellow-500",
        tone === "failed" && "bg-destructive",
        tone === "idle" && "bg-muted-foreground",
      )}
    />
  )
}

function NodeRow(props: {
  node: TreeNode
  active: boolean
  onSelect: (node: CanvasExtensionNode) => void
  onToggle: (node: CanvasExtensionNode) => void
}) {
  const { node, active, onSelect, onToggle } = props
  const Icon = nodeIcon(node)
  const inherited = selectedByParent(node)

  return (
    <div
      className={cn(
        "grid min-h-11 grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-rule/60 px-2.5 py-2 text-sm",
        active ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-secondary/25 hover:text-foreground",
      )}
    >
      <Checkbox
        checked={node.selected}
        onCheckedChange={() => onToggle(node)}
        className="h-4 w-4 rounded-[4px] border-rule bg-background"
        aria-label={`Select ${node.title}`}
      />
      <button type="button" className="grid min-w-0 grid-cols-[auto_1fr] items-center gap-2 text-left" onClick={() => onSelect(node)}>
        <Icon className={cn("h-4 w-4 shrink-0", node.kind === "course" || nodeLevel(node) === "tab" ? CANVAS_ACCENT_TEXT : active ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium">{node.title}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{node.kind} · {nodePathLabel(node)}</span>
        </span>
      </button>
      <div className="flex items-center gap-1">
        {inherited ? <Badge variant="outline" className="rounded-sm border-primary/35 px-1.5 text-[10px] text-primary">parent</Badge> : null}
        {node.importedAt ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" aria-label="Imported" /> : null}
        {node.children.length > 0 ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> : null}
      </div>
    </div>
  )
}

function Column(props: {
  title: string
  count: number
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="grid min-h-0 grid-rows-[auto_1fr] border-r border-rule bg-secondary/10">
      <div className="flex h-10 items-center justify-between border-b border-rule px-3">
        <h2 className="text-xs font-medium text-foreground">{props.title}</h2>
        <div className="flex items-center gap-1.5">
          {props.action}
          <span className="text-[11px] text-muted-foreground">{props.count}</span>
        </div>
      </div>
      <div className="min-h-0 overflow-auto">{props.children}</div>
    </section>
  )
}

function EmptyColumn({ children }: { children: ReactNode }) {
  return <p className="px-3 py-4 text-xs leading-5 text-muted-foreground">{children}</p>
}

function EventRail({ events, clientReady }: { events: CanvasExtensionCommandEvent[]; clientReady: boolean }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-foreground">Events</h3>
        <span className="text-[11px] text-muted-foreground">{events.length}</span>
      </div>
      <div className="grid max-h-48 gap-1 overflow-auto">
        {events.length > 0 ? events.slice(0, 12).map((event) => (
          <div key={event.id} className="grid gap-0.5 border border-rule bg-background px-2.5 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <StatusDot tone={event.level === "error" ? "failed" : event.level === "warning" ? "warning" : event.level === "success" ? "success" : "idle"} />
              <span className="truncate text-[12px] text-foreground">{event.message}</span>
            </div>
            <p className="truncate pl-4 text-[10px] text-muted-foreground">{event.phase} · {formatTime(event.createdAt, clientReady)}</p>
          </div>
        )) : (
          <p className="border border-rule bg-background px-2.5 py-2 text-[12px] text-muted-foreground">No events recorded.</p>
        )}
      </div>
    </div>
  )
}

function MarkdownContent({ markdown, onLinkNavigate }: { markdown: string; onLinkNavigate?: (href: string) => boolean }) {
  return (
    <div
      className={cn(
        "max-h-[64vh] overflow-auto border border-rule bg-background px-4 py-3 text-[13px] leading-6 text-foreground",
        "[&_a]:cursor-pointer [&_a]:text-[#d38a6a] [&_a]:underline [&_a:hover]:text-[#e2a184]",
        "[&_h1]:mb-2 [&_h1]:mt-1 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold",
        "[&_h3]:mb-1.5 [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_p]:my-2 [&_li]:my-1 [&_ul]:my-2 [&_ul]:ml-5 [&_ul]:list-disc [&_ol]:my-2 [&_ol]:ml-5 [&_ol]:list-decimal",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-rule [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_table]:w-full [&_th]:border-b [&_th]:border-rule [&_th]:py-1.5 [&_th]:text-left [&_td]:border-t [&_td]:border-rule [&_td]:py-1.5",
        "[&_code]:rounded-sm [&_code]:bg-accent [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[11px]",
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                if (href && onLinkNavigate?.(href)) event.preventDefault()
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

type CanvasFileView = { url: string; mimeType: string; fileName: string; sizeBytes: number | null }

function FileView({ file }: { file: CanvasFileView }) {
  const type = (file.mimeType || "").toLowerCase()

  if (type.includes("pdf")) {
    return <iframe src={file.url} title={file.fileName} className="h-[72vh] w-full border border-rule bg-white" />
  }
  if (type.startsWith("image/")) {
    return (
      <div className="flex justify-center border border-rule bg-background p-3">
        <img src={file.url} alt={file.fileName} className="max-h-[72vh] w-auto" />
      </div>
    )
  }
  if (type.startsWith("video/")) {
    return <video src={file.url} controls className="max-h-[72vh] w-full border border-rule bg-black" />
  }
  if (type.startsWith("audio/")) {
    return <audio src={file.url} controls className="w-full" />
  }

  return (
    <a
      href={file.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 border border-rule bg-secondary/10 px-4 py-6 text-sm text-foreground hover:bg-secondary/20"
    >
      <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block truncate font-medium">{file.fileName}</span>
        <span className="block text-[11px] text-muted-foreground">Open / download this file</span>
      </span>
    </a>
  )
}

function unwrapProxyUrlForMatch(value: string): string {
  // EZproxy/library links wrap the real reading in a ?url= (or ?qurl=) param; the captured
  // node is stored under that destination, so match on it rather than the shared /login path.
  try {
    const url = new URL(value)
    const inner = url.searchParams.get("url") || url.searchParams.get("qurl")
    if (inner) {
      const innerUrl = new URL(inner)
      if (innerUrl.protocol === "https:" || innerUrl.protocol === "http:") return innerUrl.toString()
    }
  } catch {
    // not a proxy url
  }
  return value
}

function normalizeUrlForMatch(value: string): string | null {
  try {
    const url = new URL(unwrapProxyUrlForMatch(value))
    // Canvas file links come in /files/<id>, /files/<id>/download, and /files/<id>/preview
    // variants; nodes store the canonical /files/<id> form.
    const path = url.pathname
      .replace(/\/+$/, "")
      .replace(/(\/files\/\d+)\/(?:download|preview)$/, "$1")
    // Treat http/https as the same target: Canvas stores some external_urls as legacy http,
    // but the captured node is stored under https.
    const host = url.host.toLowerCase()
    return `${host}${path}`.toLowerCase()
  } catch {
    return null
  }
}

function isCapturableCanvasLink(href: string, canvasOrigin: string | undefined | null): boolean {
  if (!canvasOrigin) return false
  try {
    const url = new URL(href)
    if (url.origin !== new URL(canvasOrigin).origin) return false
    // Only intercept Canvas content/file/module links. External-tool launches, quizzes, and
    // anything off-origin (JSTOR, library links, etc.) open in a new tab like Canvas itself.
    return /\/courses\/\d+\/(pages|assignments|discussion_topics|announcements|files|modules)(\/|$)/.test(url.pathname)
  } catch {
    return false
  }
}

function PagePreview(props: {
  preview: CanvasPagePreview
  disabled: boolean
  clientReady: boolean
  onCaptureUrl: (url: string) => void
}) {
  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target.closest("[data-jarvis-canvas-url]") : null
    const url = target?.getAttribute("data-jarvis-canvas-url")

    if (!url) return
    event.preventDefault()
    if (!props.disabled) props.onCaptureUrl(url)
  }

  const blocks = props.preview.blocks.length > 0
    ? props.preview.blocks
    : [{
        id: "full-page",
        type: props.preview.links.length >= 3 ? "links" as const : "text" as const,
        title: "Captured page",
        text: null,
        html: props.preview.html,
        links: props.preview.links,
        order: 0,
        truncated: props.preview.truncated,
      }]

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-foreground">Modules</h3>
        <span className="truncate text-[10px] text-muted-foreground">
          {blocks.length} block{blocks.length === 1 ? "" : "s"} · {props.preview.links.length} link{props.preview.links.length === 1 ? "" : "s"} · {formatTime(props.preview.capturedAt, props.clientReady)}
        </span>
      </div>
      <div className="grid max-h-[62vh] gap-2 overflow-auto pr-1">
        {blocks.map((block) => (
          <PreviewBlock
            key={block.id}
            block={block}
            disabled={props.disabled}
            onCaptureUrl={props.onCaptureUrl}
            onPreviewClick={handleClick}
          />
        ))}
      </div>
    </div>
  )
}

function PreviewBlock(props: {
  block: CanvasPagePreviewBlock
  disabled: boolean
  onCaptureUrl: (url: string) => void
  onPreviewClick: (event: MouseEvent<HTMLDivElement>) => void
}) {
  const title = props.block.title || (props.block.type === "links" ? "Links" : "Text")

  return (
    <section className="grid gap-2 border border-rule bg-secondary/10 px-3 py-3">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {props.block.type === "links" ? (
            <Folder className={cn("h-4 w-4 shrink-0", CANVAS_ACCENT_TEXT)} aria-hidden="true" />
          ) : (
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <h4 className="truncate text-sm font-medium text-foreground">{title}</h4>
        </div>
        <Badge variant="outline" className={cn("rounded-sm border-rule text-[10px] capitalize text-muted-foreground", props.block.type === "links" && CANVAS_ACCENT_BORDER, props.block.type === "links" && CANVAS_ACCENT_TEXT)}>
          {props.block.type}
        </Badge>
      </div>

      {props.block.type !== "links" && props.block.html ? (
        <div
          className={cn(
            "canvas-page-preview max-h-72 overflow-auto border border-rule bg-background px-3 py-2 text-xs leading-5 text-muted-foreground",
            "[&_a]:cursor-pointer [&_a]:text-[#d38a6a] [&_a]:underline [&_a:hover]:text-[#e2a184]",
            "[&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold",
            "[&_h3]:mb-1.5 [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:my-1 [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:my-2 [&_table]:w-full [&_td]:border-t [&_td]:border-rule [&_td]:py-1.5 [&_th]:border-b [&_th]:border-rule [&_th]:py-1.5 [&_ul]:ml-5 [&_ul]:list-disc",
            props.disabled && "pointer-events-none opacity-70",
          )}
          onClick={props.onPreviewClick}
          dangerouslySetInnerHTML={{ __html: props.block.html }}
        />
      ) : null}

      {props.block.links.length > 0 ? (
        <div className="grid gap-1">
          {props.block.links.map((link) => (
            <button
              key={link.url}
              type="button"
              disabled={props.disabled}
              className={cn(
                "grid min-h-9 grid-cols-[auto_1fr_auto] items-center gap-2 border border-rule bg-background px-2 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-60",
                props.block.type === "links" && CANVAS_ACCENT_HOVER_BG,
              )}
              onClick={() => props.onCaptureUrl(link.url)}
            >
              <ChevronRight className={cn("h-3.5 w-3.5", CANVAS_ACCENT_TEXT)} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-medium text-foreground">{link.text || urlPathLabel(link.url)}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{urlPathLabel(link.url)}</span>
              </span>
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}

      {props.block.truncated ? <p className="text-[11px] text-yellow-500">Block was truncated.</p> : null}
    </section>
  )
}

function ReaderPane(props: {
  selectedCourse: TreeNode | null
  selectedDoc: TreeNode | null
  clientReady: boolean
  commandBusy: boolean
  courseSyncing: boolean
  capturingFile: boolean
  onSyncCourse: (node: TreeNode) => void
  onToggleNode: (node: CanvasExtensionNode) => void
  onSelectNode: (node: CanvasExtensionNode) => void
  onCaptureFile: (href: string) => void
  onDeleteNode: (node: CanvasExtensionNode) => void
}) {
  const focusNode = props.selectedDoc || props.selectedCourse
  const focusNodeId = focusNode?.id ?? null
  // Re-capturing an external webpage (e.g. after signing in) updates the same node in place,
  // so the node id is unchanged; this timestamp changes on every capture and forces a refetch.
  const contentVersion = typeof focusNode?.metadata?.capturedAt === "string" ? focusNode.metadata.capturedAt : null
  const [content, setContent] = useState<CanvasPageContent | null>(null)
  const [contentLoading, setContentLoading] = useState(false)

  const isViewableFile = props.selectedDoc?.kind === "file" && typeof props.selectedDoc.metadata.storagePath === "string"
  const [fileView, setFileView] = useState<CanvasFileView | null>(null)
  const [fileLoading, setFileLoading] = useState(false)

  useEffect(() => {
    if (!isViewableFile || !focusNodeId) {
      setFileView(null)
      return
    }

    let cancelled = false
    setFileView(null)
    setFileLoading(true)
    fetch(`/api/integrations/canvas/extension/file-url?nodeId=${focusNodeId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) setFileView(data && data.success ? (data.file ?? null) : null)
      })
      .catch(() => {
        if (!cancelled) setFileView(null)
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [focusNodeId, isViewableFile])

  const docsByUrl = useMemo(() => {
    const map = new Map<string, TreeNode>()
    for (const child of props.selectedCourse?.children ?? []) {
      const candidates = [child.url, typeof child.metadata.actualUrl === "string" ? child.metadata.actualUrl : null]
      for (const candidate of candidates) {
        const key = candidate ? normalizeUrlForMatch(candidate) : null
        if (key && !map.has(key)) map.set(key, child)
      }
    }
    return map
  }, [props.selectedCourse])

  const handleLinkNavigate = (href: string) => {
    const key = normalizeUrlForMatch(href)
    const doc = key ? docsByUrl.get(key) : null
    if (doc) {
      // A previously-captured webpage that hit a sign-in wall: re-capture (the user may have
      // signed in since) rather than re-opening the stale login notice.
      if (doc.kind === "external_link" && doc.metadata.loginRequired === true) {
        props.onCaptureFile(href)
        return true
      }
      if (doc.id !== props.selectedDoc?.id) props.onSelectNode(doc)
      return true
    }
    if (isCapturableCanvasLink(href, props.selectedCourse?.canvasOrigin)) {
      props.onCaptureFile(href)
      return true
    }
    // Off-Canvas readings get pulled in and read inline too, instead of opening a new tab.
    if (isCaptureableExternalLink(href, props.selectedCourse?.canvasOrigin)) {
      props.onCaptureFile(href)
      return true
    }
    return false
  }

  useEffect(() => {
    if (!focusNodeId) {
      setContent(null)
      return
    }

    let cancelled = false
    setContent(null)
    setContentLoading(true)
    fetch(`/api/integrations/canvas/extension/page-content?nodeId=${focusNodeId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) setContent(data && data.success ? (data.content ?? null) : null)
      })
      .catch(() => {
        if (!cancelled) setContent(null)
      })
      .finally(() => {
        if (!cancelled) setContentLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [focusNodeId, contentVersion])

  if (!focusNode) {
    return (
      <section className="grid min-h-0 grid-rows-[auto_1fr] bg-background">
        <div className="flex h-10 items-center border-b border-rule px-3">
          <h2 className="text-xs font-medium text-foreground">Reader</h2>
        </div>
        <EmptyColumn>Select a course, then Sync it to pull its content.</EmptyColumn>
      </section>
    )
  }

  if (!props.selectedDoc) {
    const course = props.selectedCourse
    return (
      <section className="grid min-h-0 grid-rows-[auto_1fr] bg-background">
        <div className="flex h-10 items-center justify-between border-b border-rule px-3">
          <h2 className="text-xs font-medium text-foreground">Reader</h2>
          <a
            href={displayUrl(focusNode)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center justify-center rounded-sm border border-rule px-2 text-muted-foreground hover:bg-secondary/30 hover:text-foreground"
            aria-label="Open in Canvas"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
        <div className="min-h-0 overflow-auto p-6">
          <p className="break-words text-lg font-semibold leading-tight text-foreground">{course?.title}</p>
          <p className="mt-3 max-w-prose text-sm leading-6 text-muted-foreground">
            Sync this course to pull its syllabus, home page, pages, assignments, announcements, and discussions straight from Canvas. Then pick a document on the left to read it, and tick the ones you want Jarvis to use.
          </p>
          <Button
            type="button"
            className={cn("mt-4 h-9 rounded-sm border px-3 text-sm", CANVAS_ACCENT_BORDER, CANVAS_ACCENT_BG, CANVAS_ACCENT_TEXT, CANVAS_ACCENT_HOVER_BG)}
            disabled={props.commandBusy}
            onClick={() => course && props.onSyncCourse(course)}
          >
            {props.courseSyncing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            Sync course
          </Button>
        </div>
      </section>
    )
  }

  const doc = props.selectedDoc
  const legacyPreview = content?.markdown ? null : pagePreviewFor(doc)
  const isExternalLink = doc.kind === "external_link"
  const loginRequired = isExternalLink && doc.metadata.loginRequired === true
  const externalHost = typeof doc.metadata.host === "string" ? doc.metadata.host : null
  const apiSourceLabel = isExternalLink
    ? "webpage"
    : typeof doc.metadata.apiSource === "string"
      ? doc.metadata.apiSource
      : doc.kind
  const dueAt = typeof doc.metadata.dueAt === "string" ? doc.metadata.dueAt : null
  const metadata = [
    apiSourceLabel,
    doc.importedAt ? `in Jarvis · ${formatTime(doc.importedAt, props.clientReady)}` : "not imported",
    dueAt ? `due ${formatTime(dueAt, props.clientReady)}` : null,
  ].filter((value): value is string => Boolean(value))

  return (
    <section className="grid min-h-0 grid-rows-[auto_1fr] bg-background">
      <div className="flex h-10 items-center justify-between border-b border-rule px-3">
        <h2 className="text-xs font-medium text-foreground">Reader</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-sm border px-2 text-[11px]",
              doc.selected
                ? cn(CANVAS_ACCENT_BORDER, CANVAS_ACCENT_BG, CANVAS_ACCENT_TEXT)
                : "border-rule text-muted-foreground hover:bg-secondary/30 hover:text-foreground",
            )}
            onClick={() => props.onToggleNode(doc)}
          >
            {doc.selected ? (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <span className="h-3.5 w-3.5 rounded-[3px] border border-rule bg-background" aria-hidden="true" />
            )}
            {doc.selected ? "Selected for Jarvis" : "Select for Jarvis"}
          </button>
          <a
            href={displayUrl(doc)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center justify-center rounded-sm border border-rule px-2 text-muted-foreground hover:bg-secondary/30 hover:text-foreground"
            aria-label={isExternalLink ? "Open original" : "Open in Canvas"}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
          <button
            type="button"
            onClick={() => props.onDeleteNode(doc)}
            className="inline-flex h-7 items-center justify-center rounded-sm border border-rule px-2 text-muted-foreground hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
            aria-label="Delete this content"
            title="Delete this content"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="min-h-0 overflow-auto p-4">
        {props.capturingFile ? (
          <div className={cn("mb-3 flex items-center gap-2 rounded-sm border px-3 py-2 text-xs", CANVAS_ACCENT_BORDER, CANVAS_ACCENT_BG, CANVAS_ACCENT_TEXT)}>
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Fetching the linked content and reading it…
          </div>
        ) : null}
        {loginRequired ? (
          <div className="mb-3 flex items-start gap-2 rounded-sm border border-yellow-500/40 bg-yellow-500/[0.06] px-3 py-2.5 text-xs leading-5 text-foreground">
            <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-yellow-500" aria-hidden="true" />
            <span className="min-w-0">
              <span className="font-medium">Sign-in needed{externalHost ? ` at ${externalHost}` : ""}.</span>{" "}
              Open the original (top-right) and sign in — e.g. through your Northwestern library access — then try again.
              <button
                type="button"
                onClick={() => props.onCaptureFile(displayUrl(doc))}
                disabled={props.capturingFile}
                className="ml-1 font-medium text-yellow-500 underline underline-offset-2 hover:text-yellow-400 disabled:opacity-60"
              >
                Try again
              </button>
            </span>
          </div>
        ) : null}
        <div className="grid gap-1">
          <p className="break-words text-lg font-semibold leading-tight text-foreground">{doc.title}</p>
          <p className="break-all text-[11px] leading-5 text-muted-foreground">{displayUrl(doc)}</p>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {metadata.map((item) => (
            <Badge key={item} variant="outline" className="rounded-sm border-rule text-[10px] capitalize text-muted-foreground">{item}</Badge>
          ))}
        </div>
        <div className="mt-4">
          {isViewableFile ? (
            fileLoading ? (
              <div className="flex items-center gap-2 border border-rule bg-secondary/10 px-4 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading file…
              </div>
            ) : fileView ? (
              <FileView file={fileView} />
            ) : (
              <div className="border border-rule bg-secondary/10 px-4 py-6 text-center text-sm leading-6 text-muted-foreground">
                Couldn&apos;t load this file. Open it in Canvas.
              </div>
            )
          ) : content?.markdown ? (
            <section className="grid gap-2">
              {content.truncated ? <p className="text-[11px] text-yellow-500">Content was truncated.</p> : null}
              <MarkdownContent markdown={content.markdown} onLinkNavigate={handleLinkNavigate} />
            </section>
          ) : contentLoading ? (
            <div className="flex items-center gap-2 border border-rule bg-secondary/10 px-4 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading content…
            </div>
          ) : legacyPreview ? (
            <PagePreview
              preview={legacyPreview}
              disabled={props.commandBusy || props.capturingFile}
              clientReady={props.clientReady}
              onCaptureUrl={(url) => {
                if (!handleLinkNavigate(url)) window.open(url, "_blank", "noreferrer")
              }}
            />
          ) : (
            <div className="border border-rule bg-secondary/10 px-4 py-6 text-center text-sm leading-6 text-muted-foreground">
              No readable content for this item. Re-sync the course to refresh it.
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export default function CanvasExtensionSetupPage() {
  const [clientReady, setClientReady] = useState(false)
  const [pairing, setPairing] = useState<PairingState>({ status: "idle" })
  const [appOrigin, setAppOrigin] = useState("")
  const [state, setState] = useState<CanvasExtensionStateResponse | null>(null)
  const [selectedNode, setSelectedNode] = useState<CanvasExtensionNode | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [wakingExtension, setWakingExtension] = useState(false)
  const [error, setError] = useState<StateError | null>(null)
  const [wakeWarning, setWakeWarning] = useState<string | null>(null)
  const [activityOpen, setActivityOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState<string | null>(null)

  const activeCommand = state?.health.activeCommand ?? state?.commands.find((command) => isActiveCommand(command)) ?? null
  const visibleNodes = useMemo(
    () => (state?.nodes || []).filter((node) => node.kind === "course" || Boolean(node.parentId)),
    [state?.nodes],
  )
  const tree = useMemo(() => buildTree(visibleNodes), [visibleNodes])
  const treeNodesById = useMemo(() => {
    const nodes = new Map<string, TreeNode>()
    const visit = (node: TreeNode) => {
      nodes.set(node.id, node)
      for (const child of node.children) visit(child)
    }

    for (const node of tree) visit(node)
    return nodes
  }, [tree])
  const courses = useMemo(() => tree.filter((node) => node.kind === "course"), [tree])
  const selectedTreeNode = selectedNode ? treeNodesById.get(selectedNode.id) ?? null : null
  const selectedCourse = ancestorByLevel(selectedTreeNode, treeNodesById, "course")
  const selectedDoc = selectedTreeNode && Boolean(selectedTreeNode.parentId) ? selectedTreeNode : null
  const courseDocs = selectedCourse?.children ?? []
  const courseSyncing = Boolean(selectedCourse) && (
    busyAction === `sync_course:${selectedCourse?.id}:` ||
    (activeCommand?.targetNodeId === selectedCourse?.id && isActiveCommand(activeCommand))
  )
  const selectedCount = visibleNodes.filter((node) => node.selected && !node.importedAt).length
  const commandBusy = Boolean(busyAction || isActiveCommand(activeCommand))
  const status = statusCopy({
    session: state?.session ?? null,
    activeCommand,
    lastEvent: state?.health.lastEvent ?? state?.events[0] ?? null,
    error,
    loaded: Boolean(state),
    clientReady,
  })

  async function refreshState(options: { quiet?: boolean } = {}) {
    if (!options.quiet) setRefreshing(true)
    try {
      const payload = await readStateResponse(
        await fetch("/api/integrations/canvas/extension/state", { cache: "no-store" }),
      )
      setState(payload)
      setSelectedNode((current) => current ? payload.nodes.find((node) => node.id === current.id) ?? null : current)
      setError(null)
    } catch (refreshError) {
      const shaped = refreshError as Error & { stateError?: StateError }
      setError(shaped.stateError ?? {
        code: "backend_error",
        message: "Failed to load Canvas extension state.",
        details: refreshError instanceof Error ? refreshError.message : "Unknown state error.",
      })
    } finally {
      if (!options.quiet) setRefreshing(false)
    }
  }

  async function refreshAfterCommandWake() {
    await new Promise((resolve) => window.setTimeout(resolve, COMMAND_SETTLE_REFRESH_DELAY_MS))
    await refreshState()
  }

  useEffect(() => {
    setClientReady(true)
    setAppOrigin(window.location.origin)
    refreshState()
  }, [])

  useEffect(() => {
    if (!isActiveCommand(activeCommand)) return

    const intervalId = window.setInterval(() => {
      refreshState({ quiet: true }).catch((refreshError) => {
        const shaped = refreshError as Error & { stateError?: StateError }
        setError(shaped.stateError ?? {
          code: "backend_error",
          message: "Failed to stream Canvas extension state.",
          details: refreshError instanceof Error ? refreshError.message : "Unknown state error.",
        })
      })
    }, COMMAND_LIVE_REFRESH_MS)

    return () => window.clearInterval(intervalId)
  }, [activeCommand?.id, activeCommand?.status])

  useEffect(() => {
    if (!pendingFile) return
    const key = normalizeUrlForMatch(pendingFile)
    if (!key) {
      setPendingFile(null)
      return
    }

    const match = (state?.nodes ?? []).find((node) => {
      if (normalizeUrlForMatch(node.url) === key) return true
      const actual = typeof node.metadata.actualUrl === "string" ? node.metadata.actualUrl : null
      return actual ? normalizeUrlForMatch(actual) === key : false
    })

    if (match) {
      setSelectedNode(match)
      setPendingFile(null)
    }
  }, [state?.nodes, pendingFile])

  useEffect(() => {
    if (!pendingFile) return
    const timeout = window.setTimeout(() => setPendingFile(null), 60_000)
    return () => window.clearTimeout(timeout)
  }, [pendingFile])

  async function createPairingCode() {
    setPairing({ status: "loading" })

    try {
      const payload = await readJson<CanvasExtensionPairingCodeResponse>(
        await fetch("/api/integrations/canvas/extension/pairing-code", { method: "POST" }),
        "Failed to create pairing code.",
      )

      setPairing({ status: "ready", code: payload.code, expiresAt: payload.expiresAt })
    } catch (pairingError) {
      setPairing({
        status: "error",
        message: pairingError instanceof Error ? pairingError.message : "Failed to create pairing code.",
      })
    }
  }

  async function runCommand(
    type: "discover" | "expand_node" | "import_selected" | "capture_url" | "sync_course" | "stop" | "resume",
    targetNodeId?: string,
    payload: { url?: string } = {},
  ) {
    setBusyAction(`${type}:${targetNodeId ?? ""}:${payload.url ?? ""}`)
    setError(null)
    setWakeWarning(null)

    try {
      await readJson(
        await fetch("/api/integrations/canvas/extension/commands", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, targetNodeId, ...payload }),
        }),
        "Failed to create Canvas extension command.",
      )
      await refreshState()
      if (type !== "stop") {
        try {
          await requestExtensionPollNow()
          await refreshAfterCommandWake()
        } catch (wakeError) {
          setWakeWarning(wakeError instanceof Error ? wakeError.message : "Canvas Reader wake failed.")
        }
      }
    } catch (commandError) {
      setError({
        code: "command_failed",
        message: "Canvas command failed.",
        details: commandError instanceof Error ? commandError.message : "Canvas extension command failed.",
      })
    } finally {
      setBusyAction(null)
    }
  }

  async function captureFile(href: string) {
    if (!selectedCourse) return
    setPendingFile(href)
    await runCommand("capture_url", selectedCourse.id, { url: href })
  }

  async function toggleNode(node: CanvasExtensionNode) {
    setError(null)
    try {
      await readJson(
        await fetch("/api/integrations/canvas/extension/nodes", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nodeId: node.id, selected: !node.selected }),
        }),
        "Failed to update Canvas node selection.",
      )
      await refreshState()
    } catch (selectionError) {
      setError({
        code: "selection_failed",
        message: "Selection failed.",
        details: selectionError instanceof Error ? selectionError.message : "Failed to update selection.",
      })
    }
  }

  async function deleteNode(node: CanvasExtensionNode) {
    if (typeof window !== "undefined" && !window.confirm(`Delete "${node.title}" from the reader? This can't be undone.`)) {
      return
    }
    setError(null)
    try {
      await readJson(
        await fetch("/api/integrations/canvas/extension/nodes", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nodeId: node.id }),
        }),
        "Failed to delete this content.",
      )
      if (selectedNode?.id === node.id) setSelectedNode(null)
      await refreshState()
    } catch (deleteError) {
      setError({
        code: "delete_failed",
        message: "Delete failed.",
        details: deleteError instanceof Error ? deleteError.message : "Failed to delete content.",
      })
    }
  }

  async function copyCode() {
    if (pairing.status === "ready") await navigator.clipboard.writeText(pairing.code)
  }

  async function copyAppOrigin() {
    if (appOrigin) await navigator.clipboard.writeText(appOrigin)
  }

  async function requestExtensionViaContentScript() {
    const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        window.removeEventListener("message", handleMessage)
        reject(new Error("Could not reach the Canvas Reader from this page. Reload the unpacked extension, refresh this page, then try again."))
      }, 5000)

      function handleMessage(event: MessageEvent) {
        if (event.source !== window || event.origin !== window.location.origin) return
        const message = event.data
        if (!message || message.type !== "JARVIS_CANVAS_EXTENSION_RESPONSE" || message.id !== requestId) return

        window.clearTimeout(timeout)
        window.removeEventListener("message", handleMessage)

        if (message.ok) {
          resolve(message.result)
        } else {
          reject(new Error(typeof message.error === "string" ? message.error : "Canvas Reader wake failed."))
        }
      }

      window.addEventListener("message", handleMessage)
      window.postMessage({
        type: "JARVIS_CANVAS_EXTENSION_REQUEST",
        id: requestId,
        action: "POLL_NOW",
      }, window.location.origin)
    })
  }

  async function requestExtensionDirectly() {
    const chromeRuntime = (window as Window & { chrome?: ChromeRuntime }).chrome?.runtime

    if (!chromeRuntime?.sendMessage) {
      throw new Error("Chrome external extension messaging is not available on this page.")
    }

    const failures: string[] = []

    for (const extensionId of KNOWN_CANVAS_EXTENSION_IDS) {
      const result = await new Promise<unknown>((resolve, reject) => {
        chromeRuntime.sendMessage?.(extensionId, { type: "POLL_NOW" }, (response) => {
          const runtimeError = chromeRuntime.lastError?.message
          if (runtimeError) {
            reject(new Error(runtimeError))
            return
          }

          resolve(response)
        })
      }).catch((directError) => {
        failures.push(directError instanceof Error ? directError.message : "Unknown extension messaging failure.")
        return null
      })

      if (result && typeof result === "object" && "success" in result && result.success === true) return result
    }

    throw new Error(failures[0] || "Could not reach the Canvas Reader through Chrome messaging.")
  }

  async function requestExtensionPollNow() {
    try {
      return await requestExtensionDirectly()
    } catch {
      return requestExtensionViaContentScript()
    }
  }

  async function wakeExtension() {
    setWakingExtension(true)
    setError(null)
    setWakeWarning(null)

    try {
      await requestExtensionPollNow()
      await refreshAfterCommandWake()
    } catch (wakeError) {
      setError({
        code: "extension_offline",
        message: "Canvas Reader did not respond.",
        details: wakeError instanceof Error ? wakeError.message : "Canvas Reader wake failed.",
      })
    } finally {
      setWakingExtension(false)
    }
  }

  return (
    <main className="relative min-h-screen bg-background text-foreground">
      <div className="grid h-screen grid-rows-[auto_1fr]">
        <header className="grid gap-3 border-b border-rule bg-background px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Link href="/dashboard" className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-secondary/30 hover:text-foreground" aria-label="Dashboard">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </Link>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold tracking-normal">Canvas Reader</h1>
                <p className="truncate text-xs text-muted-foreground">
                  {state?.session?.canvasOrigin || "No Canvas origin yet"} · last seen {formatTime(state?.session?.lastSeenAt, clientReady)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <IconButton label="Activity log" onClick={() => setActivityOpen((open) => !open)}>
                <Clock3 className="h-4 w-4" aria-hidden="true" />
              </IconButton>
              <IconButton label="Reload state" disabled={refreshing} onClick={refreshState}>
                {refreshing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
              </IconButton>
              <IconButton label="Wake extension" disabled={wakingExtension} onClick={wakeExtension}>
                {wakingExtension ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Wifi className="h-4 w-4" aria-hidden="true" />}
              </IconButton>
            </div>
          </div>
          {activityOpen ? (
            <div className="absolute right-4 top-16 z-30 w-[min(420px,calc(100vw-2rem))] border border-rule bg-background p-3 shadow-xl">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Activity</p>
                  <p className="text-[11px] text-muted-foreground">{state?.events.length ?? 0} event{(state?.events.length ?? 0) === 1 ? "" : "s"}</p>
                </div>
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-rule text-muted-foreground hover:bg-secondary/30 hover:text-foreground"
                  onClick={() => setActivityOpen(false)}
                  aria-label="Close activity log"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              <EventRail events={state?.events ?? []} clientReady={clientReady} />
            </div>
          ) : null}
          <div
            className={cn(
              "grid min-h-10 grid-cols-[auto_1fr_auto] items-center gap-3 border px-3 py-2",
              status.tone === "success" && "border-green-500/30 bg-green-500/10",
              status.tone === "running" && "border-primary/35 bg-primary/10",
              status.tone === "warning" && "border-yellow-500/30 bg-yellow-500/10",
              status.tone === "failed" && "border-destructive/35 bg-destructive/10",
              status.tone === "idle" && "border-rule bg-secondary/10",
            )}
          >
            {status.tone === "failed" ? <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" /> : status.tone === "warning" ? <WifiOff className="h-4 w-4 text-yellow-500" aria-hidden="true" /> : <StatusDot tone={status.tone} />}
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-sm font-medium">{status.label}</span>
                {activeCommand ? <Badge variant="outline" className="rounded-sm border-rule text-[10px] text-muted-foreground">{commandLabel(activeCommand)}</Badge> : null}
              </div>
              <p className="truncate text-xs text-muted-foreground">{status.detail}</p>
              {wakeWarning ? <p className="truncate text-xs text-yellow-500">{wakeWarning}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              {activeCommand?.status === "pending" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-sm px-2 text-[11px]"
                  disabled={wakingExtension}
                  onClick={wakeExtension}
                >
                  {wakingExtension ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Wifi className="h-3.5 w-3.5" aria-hidden="true" />}
                  Wake
                </Button>
              ) : null}
              <span className="text-[11px] text-muted-foreground">{state?.health.authStatus ?? error?.code ?? "loading"}</span>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 grid-cols-[240px_minmax(0,1fr)]">
          <aside className="grid min-h-0 content-start gap-4 border-r border-rule bg-secondary/10 p-3">
            <section className="grid gap-2">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-medium text-foreground">Setup</h2>
                <a href="/downloads/jarvis-canvas-reader.zip" className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-rule text-muted-foreground hover:bg-secondary/30 hover:text-foreground" aria-label="Download extension ZIP">
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </div>
              <div className="grid gap-1.5">
                <div className="grid grid-cols-[1fr_auto] items-center gap-2 border border-rule bg-background px-2 py-1.5">
                  <span className="truncate font-mono text-[11px] text-muted-foreground">{appOrigin || "Loading..."}</span>
                  <button type="button" className="text-muted-foreground hover:text-foreground" onClick={copyAppOrigin} aria-label="Copy app URL">
                    <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
                <Button type="button" variant="outline" className="h-8 rounded-sm text-xs" disabled={pairing.status === "loading"} onClick={createPairingCode}>
                  {pairing.status === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />}
                  Pairing code
                </Button>
                {pairing.status === "ready" ? (
                  <button type="button" className="grid gap-0.5 border border-primary/35 bg-primary/10 px-2 py-2 text-left" onClick={copyCode}>
                    <span className="font-mono text-sm tracking-[0.12em] text-foreground">{pairing.code}</span>
                    <span className="text-[10px] text-muted-foreground">expires {formatTime(pairing.expiresAt, clientReady)}</span>
                  </button>
                ) : pairing.status === "error" ? (
                  <p className="border border-destructive/35 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">{pairing.message}</p>
                ) : null}
              </div>
            </section>

            <section className="grid gap-2">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-medium text-foreground">Controls</h2>
                <Badge variant="outline" className="rounded-sm border-rule text-[10px] text-muted-foreground">{selectedCount} selected</Badge>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                <IconButton label="Discover courses" disabled={commandBusy} onClick={() => runCommand("discover")}>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                </IconButton>
                <IconButton label="Sync selected course" disabled={!selectedCourse || commandBusy} onClick={() => selectedCourse && runCommand("sync_course", selectedCourse.id)} tone="canvas">
                  <Download className="h-4 w-4" aria-hidden="true" />
                </IconButton>
                <IconButton label="Import selected into Jarvis" disabled={selectedCount === 0 || commandBusy} onClick={() => runCommand("import_selected")}>
                  <Play className="h-4 w-4" aria-hidden="true" />
                </IconButton>
                <IconButton label="Stop command" disabled={!activeCommand || activeCommand.status === "cancel_requested"} onClick={() => runCommand("stop")}>
                  <Square className="h-4 w-4" aria-hidden="true" />
                </IconButton>
              </div>
            </section>
          </aside>

          <section className="grid min-h-0 grid-cols-[minmax(190px,0.7fr)_minmax(190px,0.7fr)_minmax(520px,1.8fr)]">
            <Column title="Courses" count={courses.length}>
              {courses.length > 0 ? courses.map((node) => (
                <NodeRow
                  key={node.id}
                  node={node}
                  active={selectedCourse?.id === node.id}
                  onSelect={setSelectedNode}
                  onToggle={toggleNode}
                />
              )) : <EmptyColumn>Discover All Courses after opening Canvas.</EmptyColumn>}
            </Column>

            <section className="grid min-h-0 grid-rows-[auto_1fr_auto] border-r border-rule bg-secondary/10">
              <div className="flex h-9 items-center justify-between border-b border-rule px-3">
                <h2 className="text-xs font-medium text-foreground">Course content</h2>
                <span className="text-[11px] text-muted-foreground">{courseDocs.length}</span>
              </div>
              <div className="min-h-0 overflow-auto">
                {!selectedCourse ? (
                  <EmptyColumn>Select a course.</EmptyColumn>
                ) : courseDocs.length > 0 ? (
                  courseDocs.map((node) => (
                    <NodeRow
                      key={node.id}
                      node={node}
                      active={selectedDoc?.id === node.id}
                      onSelect={setSelectedNode}
                      onToggle={toggleNode}
                    />
                  ))
                ) : (
                  <div className="grid gap-3 px-3 py-4">
                    <p className="text-xs leading-5 text-muted-foreground">
                      No content yet. Sync this course to pull its syllabus, pages, assignments, and announcements from Canvas.
                    </p>
                    <Button
                      type="button"
                      className={cn("h-8 rounded-sm border px-2.5 text-xs", CANVAS_ACCENT_BORDER, CANVAS_ACCENT_BG, CANVAS_ACCENT_TEXT, CANVAS_ACCENT_HOVER_BG)}
                      disabled={commandBusy}
                      onClick={() => selectedCourse && runCommand("sync_course", selectedCourse.id)}
                    >
                      {courseSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Download className="h-3.5 w-3.5" aria-hidden="true" />}
                      Sync course
                    </Button>
                  </div>
                )}
              </div>
              {selectedCourse && courseDocs.length > 0 ? (
                <div className="grid grid-cols-2 gap-1.5 border-t border-rule p-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 rounded-sm text-xs"
                    disabled={commandBusy}
                    onClick={() => runCommand("sync_course", selectedCourse.id)}
                  >
                    {courseSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
                    Re-sync
                  </Button>
                  <Button
                    type="button"
                    className={cn("h-8 rounded-sm border px-2.5 text-xs", CANVAS_ACCENT_BORDER, CANVAS_ACCENT_BG, CANVAS_ACCENT_TEXT, CANVAS_ACCENT_HOVER_BG)}
                    disabled={selectedCount === 0 || commandBusy}
                    onClick={() => runCommand("import_selected")}
                  >
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    Import{selectedCount > 0 ? ` ${selectedCount}` : ""}
                  </Button>
                </div>
              ) : null}
            </section>

            <ReaderPane
              selectedCourse={selectedCourse}
              selectedDoc={selectedDoc}
              clientReady={clientReady}
              commandBusy={commandBusy}
              courseSyncing={courseSyncing}
              capturingFile={Boolean(pendingFile)}
              onSyncCourse={(node) => runCommand("sync_course", node.id)}
              onToggleNode={toggleNode}
              onSelectNode={setSelectedNode}
              onCaptureFile={captureFile}
              onDeleteNode={deleteNode}
            />
          </section>
        </div>
      </div>
    </main>
  )
}
