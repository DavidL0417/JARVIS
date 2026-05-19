"use client"

import Link from "next/link"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Clock3,
  CircleDot,
  Download,
  ExternalLink,
  KeyRound,
  Loader2,
  Play,
  RefreshCw,
  Square,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import type {
  CanvasExtensionCommand,
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

const KNOWN_CANVAS_EXTENSION_IDS = ["aogoejlpbjmfmmdelknoebibkbhlmplc"]

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

function isActiveCommand(command: CanvasExtensionCommand | null) {
  return Boolean(command && ["pending", "running", "cancel_requested"].includes(command.status))
}

function commandStatus(command: CanvasExtensionCommand | null) {
  if (!command) {
    return {
      label: "Idle",
      detail: "No Canvas run is active.",
      tone: "idle",
      icon: CircleDot,
    }
  }

  if (command.status === "pending") {
    return {
      label: "Queued",
      detail: "Queued in JARVIS. The extension has not claimed it yet.",
      tone: "queued",
      icon: Clock3,
    }
  }

  if (command.status === "running") {
    return {
      label: "Running",
      detail: "The extension is reading Canvas now.",
      tone: "running",
      icon: Loader2,
    }
  }

  if (command.status === "cancel_requested") {
    return {
      label: "Stopping",
      detail: "Stop requested. Waiting for the extension to halt.",
      tone: "stopping",
      icon: Square,
    }
  }

  if (command.status === "failed") {
    return {
      label: "Failed",
      detail: command.errorMessage || "The last Canvas run failed.",
      tone: "failed",
      icon: AlertTriangle,
    }
  }

  return {
    label: command.status === "cancelled" ? "Stopped" : "Done",
    detail: command.status === "cancelled" ? "The last run was stopped." : "The last run completed.",
    tone: "done",
    icon: CheckCircle2,
  }
}

function commandName(command: CanvasExtensionCommand | null, target: CanvasExtensionNode | null) {
  if (!command) return "Ready"
  if (command.type === "discover") return "Discover courses"
  if (command.type === "import_selected") return "Import selected"
  if (command.type === "expand_node") {
    if (target && nodeLevel(target) === "course") return "Scrape tabs"
    if (target && nodeLevel(target) === "tab") return "Scrape items"
    return "Scrape Canvas"
  }
  return "Canvas run"
}

function buildTree(nodes: CanvasExtensionNode[]) {
  const byId = new Map<string, TreeNode>()
  const roots: TreeNode[] = []

  for (const node of nodes) {
    byId.set(node.id, { ...node, children: [] })
  }

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

function isSessionConnected(session: CanvasExtensionSession | null | undefined, clientReady: boolean) {
  return Boolean(clientReady && session && Date.now() - new Date(session.lastSeenAt).getTime() < 90_000)
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

function RunStatus(props: {
  command: CanvasExtensionCommand | null
  target: CanvasExtensionNode | null
  session: CanvasExtensionSession | null
  clientReady: boolean
  refreshing: boolean
  onRefresh: () => void
}) {
  const { command, target, session, clientReady, refreshing, onRefresh } = props
  const status = commandStatus(command)
  const Icon = status.icon
  const message = command?.result.message
  const connected = isSessionConnected(session, clientReady)
  const messageText = typeof message === "string"
    ? message
    : command?.errorMessage
      ? command.errorMessage
      : command?.status === "pending" && !connected
        ? "Extension is offline or stale. Open Canvas, then use Refresh extension above."
        : command?.status === "pending"
          ? "Queued in JARVIS. Refresh extension asks Chrome to claim it now."
          : status.detail

  return (
    <div
      className={cn(
        "flex min-h-12 flex-wrap items-center justify-between gap-3 border border-rule bg-background px-3 py-2",
        status.tone === "queued" && "border-primary/35 bg-primary/10",
        status.tone === "running" && "border-primary/45 bg-primary/15",
        status.tone === "stopping" && "border-yellow-500/35 bg-yellow-500/10",
        status.tone === "failed" && "border-destructive/35 bg-destructive/10",
      )}
      aria-live="polite"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-rule bg-secondary/25 text-muted-foreground",
            status.tone === "queued" && "border-primary/35 text-primary",
            status.tone === "running" && "border-primary/45 text-primary",
            status.tone === "stopping" && "border-yellow-500/45 text-yellow-500",
            status.tone === "failed" && "border-destructive/45 text-destructive",
            status.tone === "done" && "border-green-500/35 text-green-500",
          )}
        >
          <Icon className={cn("h-4 w-4", status.tone === "running" && "animate-spin")} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">{status.label}</span>
            <span className="text-sm text-muted-foreground">{commandName(command, target)}</span>
            {target ? <Badge variant="outline" className="max-w-[220px] truncate rounded-sm border-rule text-[10px] text-muted-foreground">{target.title}</Badge> : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">{messageText || status.detail}</p>
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" className="h-8 rounded-sm" disabled={refreshing} onClick={onRefresh}>
        {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
        Status
      </Button>
    </div>
  )
}

function SessionStatus(props: {
  session: CanvasExtensionSession | null
  clientReady: boolean
  wakingExtension: boolean
  onWakeExtension: () => void
}) {
  const { session, clientReady, wakingExtension, onWakeExtension } = props
  const connected = isSessionConnected(session, clientReady)

  return (
    <div className="grid gap-1 text-sm text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", connected ? "bg-green-500" : "bg-yellow-500")} />
        <span className="font-medium text-foreground">{connected ? "Extension connected" : session ? "Extension stale" : "Extension not connected"}</span>
        {session ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-1 h-7 rounded-sm px-2 text-xs"
            disabled={wakingExtension}
            onClick={onWakeExtension}
          >
            {wakingExtension ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
            Refresh extension
          </Button>
        ) : null}
      </div>
      <p>Last seen {formatTime(session?.lastSeenAt, clientReady)}{session?.canvasOrigin ? ` · ${session.canvasOrigin}` : ""}</p>
      <p>{session?.activeTitle || session?.activeUrl || "Open Canvas in Chrome, then use the controls below."}</p>
    </div>
  )
}

function NodeRow(props: {
  node: TreeNode
  active: boolean
  onSelect: (node: CanvasExtensionNode) => void
  onToggle: (node: CanvasExtensionNode) => void
}) {
  const { node, active, onSelect, onToggle } = props
  const inherited = selectedByParent(node)
  const level = nodeLevel(node)

  return (
    <div
      className={cn(
        "grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-rule/70 px-3 py-2.5 text-sm transition-colors",
        active ? "bg-primary/10" : "hover:bg-secondary/20",
      )}
    >
      <Checkbox
        checked={node.selected}
        onCheckedChange={() => onToggle(node)}
        className="h-4 w-4 rounded-[4px] border-rule bg-background data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
        aria-label={`Select ${node.title}`}
      />
      <button type="button" className="min-w-0 text-left" onClick={() => onSelect(node)}>
        <span className="block truncate text-foreground">{node.title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {level} · {nodePathLabel(node)}
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        {node.children.length > 0 ? <Badge variant="outline" className="rounded-sm border-rule text-[10px] text-muted-foreground">{node.children.length}</Badge> : null}
        {inherited ? <Badge variant="outline" className="rounded-sm border-primary/40 text-[10px] text-primary">parent</Badge> : null}
        {node.importedAt ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" aria-label="Imported" /> : null}
      </div>
    </div>
  )
}

function EmptyPanel({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-sm border border-rule bg-background p-3 text-sm text-muted-foreground">
      {children}
    </p>
  )
}

function NodeDetails({ node, clientReady }: { node: CanvasExtensionNode; clientReady: boolean }) {
  const metadata = [
    node.kind,
    node.importedAt ? `imported ${formatTime(node.importedAt, clientReady)}` : "not imported",
    nodePathLabel(node),
  ].filter(Boolean)

  return (
    <div className="grid gap-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xl font-medium text-foreground">{node.title}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{metadata.join(" · ")}</p>
        </div>
        <a
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-sm border border-rule bg-background px-2.5 text-xs font-medium text-primary hover:bg-secondary/30"
          href={displayUrl(node)}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          Canvas
        </a>
      </div>
      {node.textPreview ? (
        <p className="max-h-20 overflow-hidden rounded-sm border border-rule bg-background px-3 py-2 text-xs leading-5 text-muted-foreground">
          {node.textPreview}
        </p>
      ) : null}
    </div>
  )
}

function NodeList(props: {
  title: string
  nodes: TreeNode[]
  selectedNodeId: string | null
  empty: string
  onSelect: (node: CanvasExtensionNode) => void
  onToggle: (node: CanvasExtensionNode) => void
}) {
  const { title, nodes, selectedNodeId, empty, onSelect, onToggle } = props

  return (
    <div>
      <div className="border-b border-rule pb-2">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
      </div>
      {nodes.length > 0 ? (
        <div className="max-h-[420px] overflow-auto border-x border-rule bg-background">
          {nodes.map((child) => (
            <NodeRow
              key={child.id}
              node={child}
              active={selectedNodeId === child.id}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </div>
      ) : (
        <EmptyPanel>{empty}</EmptyPanel>
      )}
    </div>
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
  const [error, setError] = useState<string | null>(null)

  const activeCommand = useMemo(
    () => state?.commands.find((command) => ["pending", "running", "cancel_requested"].includes(command.status)) ?? null,
    [state?.commands],
  )
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
  const activeCommandTarget = activeCommand?.targetNodeId ? treeNodesById.get(activeCommand.targetNodeId) ?? null : null
  const courses = useMemo(() => tree.filter((node) => node.kind === "course"), [tree])
  const selectedTreeNode = selectedNode ? treeNodesById.get(selectedNode.id) ?? null : null
  const selectedCourse = ancestorByLevel(selectedTreeNode, treeNodesById, "course")
  const selectedTab = ancestorByLevel(selectedTreeNode, treeNodesById, "tab")
  const selectedItem = selectedTreeNode && nodeLevel(selectedTreeNode) === "item"
    ? selectedTreeNode
    : null
  const scrapeTarget = selectedTab || selectedCourse
  const scrapeLabel = selectedTab ? "Scrape items" : "Scrape tabs"
  const scrapeCommand = scrapeTarget && activeCommand?.targetNodeId === scrapeTarget.id ? activeCommand : null
  const scrapeStatus = commandStatus(scrapeCommand)
  const selectedCount = visibleNodes.filter((node) => node.selected && !node.importedAt).length

  async function refreshState() {
    setRefreshing(true)
    try {
      const payload = await readJson<CanvasExtensionStateResponse>(
        await fetch("/api/integrations/canvas/extension/state", { cache: "no-store" }),
        "Failed to load Canvas extension state.",
      )
      setState(payload)
      setSelectedNode((current) => current ? payload.nodes.find((node) => node.id === current.id) ?? null : current)
      setError(null)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    setClientReady(true)
    setAppOrigin(window.location.origin)
    refreshState().catch((refreshError) => setError(refreshError instanceof Error ? refreshError.message : "Failed to load state."))
  }, [])

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

  async function runCommand(type: "discover" | "expand_node" | "import_selected" | "stop" | "resume", targetNodeId?: string) {
    setBusyAction(type)
    setError(null)

    try {
      await readJson(
        await fetch("/api/integrations/canvas/extension/commands", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, targetNodeId }),
        }),
        "Failed to create Canvas extension command.",
      )
      await refreshState()
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : "Canvas extension command failed.")
    } finally {
      setBusyAction(null)
    }
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
      setError(selectionError instanceof Error ? selectionError.message : "Failed to update selection.")
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
        reject(new Error("Could not reach the Canvas extension from this page. Reload the unpacked extension, refresh this page, then try again."))
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
          reject(new Error(typeof message.error === "string" ? message.error : "Canvas extension refresh failed."))
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
          const error = chromeRuntime.lastError?.message
          if (error) {
            reject(new Error(error))
            return
          }

          resolve(response)
        })
      }).catch((error) => {
        failures.push(error instanceof Error ? error.message : "Unknown extension messaging failure.")
        return null
      })

      if (result && typeof result === "object" && "success" in result && result.success === true) {
        return result
      }
    }

    throw new Error(failures[0] || "Could not reach the Canvas extension through Chrome messaging.")
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

    try {
      await requestExtensionPollNow()
      await refreshState()
    } catch (wakeError) {
      setError(wakeError instanceof Error ? wakeError.message : "Canvas extension refresh failed.")
    } finally {
      setWakingExtension(false)
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex items-center justify-between gap-4 border-b border-rule pb-4">
          <Link href="/dashboard" className="inline-flex items-center gap-2 text-[12px] font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Dashboard
          </Link>
          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Canvas control plane</span>
        </div>

        <section className="grid gap-4 border border-rule bg-secondary/10 p-4 md:grid-cols-[1fr_auto]">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-normal text-foreground">Canvas Academic Reader</h1>
            <SessionStatus
              session={state?.session ?? null}
              clientReady={clientReady}
              wakingExtension={wakingExtension}
              onWakeExtension={wakeExtension}
            />
          </div>
          <div className="grid min-w-[260px] gap-2">
            <a href="/downloads/jarvis-canvas-reader.zip" className="inline-flex h-10 items-center justify-center gap-2 rounded-sm border border-rule bg-secondary/20 px-4 text-sm font-medium hover:bg-secondary/35">
              <Download className="h-4 w-4" aria-hidden="true" />
              Download ZIP
            </a>
            <Button type="button" className="h-10 rounded-sm" onClick={createPairingCode} disabled={pairing.status === "loading"}>
              {pairing.status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
              Create pairing code
            </Button>
          </div>
        </section>

        <section className="grid gap-3 border border-rule bg-secondary/10 p-4 md:grid-cols-2">
          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-foreground">Extension setup</h2>
              <Button type="button" size="sm" variant="outline" className="h-8 rounded-sm" onClick={copyAppOrigin} disabled={!appOrigin}>
                <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
                Copy app URL
              </Button>
            </div>
            <div className="rounded-sm border border-rule bg-background px-4 py-3 font-mono text-sm text-foreground">{appOrigin || "Loading app URL..."}</div>
          </div>
          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-foreground">Pairing code</h2>
              {pairing.status === "ready" ? (
                <Button type="button" size="sm" variant="outline" className="h-8 rounded-sm" onClick={copyCode}>
                  <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
                  Copy
                </Button>
              ) : null}
            </div>
            {pairing.status === "ready" ? (
              <div className="rounded-sm border border-rule bg-background px-4 py-3">
                <p className="font-mono text-xl tracking-[0.14em]">{pairing.code}</p>
                <p className="text-xs text-muted-foreground">Expires {new Date(pairing.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</p>
              </div>
            ) : pairing.status === "error" ? (
              <p className="text-sm text-destructive">{pairing.message}</p>
            ) : (
              <p className="rounded-sm border border-rule bg-background px-4 py-3 text-sm text-muted-foreground">Create a pairing code when the extension is ready.</p>
            )}
          </div>
        </section>

        <section className="grid gap-3 border border-rule bg-secondary/10 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
            <Button type="button" className="h-9 rounded-sm" disabled={Boolean(busyAction || isActiveCommand(activeCommand))} onClick={() => runCommand("discover")}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Discover
            </Button>
            <Button type="button" className="h-9 rounded-sm" disabled={selectedCount === 0 || Boolean(busyAction || isActiveCommand(activeCommand))} onClick={() => runCommand("import_selected")}>
              <Play className="h-4 w-4" aria-hidden="true" />
              Import selected ({selectedCount})
            </Button>
            <Button type="button" variant="outline" className="h-9 rounded-sm" disabled={!activeCommand || activeCommand.status === "cancel_requested"} onClick={() => runCommand("stop")}>
              <Square className="h-4 w-4" aria-hidden="true" />
              Stop
            </Button>
            <Button type="button" variant="outline" className="h-9 rounded-sm" disabled={Boolean(busyAction || isActiveCommand(activeCommand)) || selectedCount === 0} onClick={() => runCommand("resume")}>
              <Play className="h-4 w-4" aria-hidden="true" />
              Resume
            </Button>
            </div>
            {busyAction ? (
              <span className="inline-flex h-8 items-center gap-2 rounded-sm border border-rule bg-background px-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Creating command
              </span>
            ) : null}
          </div>
          <RunStatus
            command={activeCommand}
            target={activeCommandTarget}
            session={state?.session ?? null}
            clientReady={clientReady}
            refreshing={refreshing}
            onRefresh={() => refreshState().catch((refreshError) => setError(refreshError instanceof Error ? refreshError.message : "Failed to load state."))}
          />
          {error ? (
            <div className="flex items-center gap-2 border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}
        </section>

        <section className="grid min-h-[520px] gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="border border-rule bg-secondary/10">
            <div className="border-b border-rule px-3 py-2">
              <h2 className="text-sm font-medium">Courses</h2>
            </div>
            <div className="max-h-[620px] overflow-auto bg-background">
              {courses.length > 0 ? courses.map((node) => (
                <NodeRow
                  key={node.id}
                  node={node}
                  active={selectedCourse?.id === node.id}
                  onSelect={setSelectedNode}
                  onToggle={toggleNode}
                />
              )) : (
                <p className="p-4 text-sm text-muted-foreground">Click Discover after opening Canvas in Chrome.</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 border border-rule bg-secondary/10 p-4 content-start">
            <div className="grid gap-3 border-b border-rule pb-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-medium">Selected course</h2>
                {scrapeTarget ? (
                  <div className="flex items-center gap-2">
                    {selectedItem ? (
                      <span className="text-xs text-muted-foreground">Select tab to scrape</span>
                    ) : activeCommand && !scrapeCommand ? (
                      <span className="text-xs text-muted-foreground">Canvas run active</span>
                    ) : null}
                    <Button
                      type="button"
                      className={cn(
                        "h-9 min-w-36 rounded-sm px-4",
                        scrapeCommand?.status === "running" && "cursor-wait",
                      )}
                      disabled={Boolean(busyAction || isActiveCommand(activeCommand) || selectedItem)}
                      onClick={() => runCommand("expand_node", scrapeTarget.id)}
                    >
                      {busyAction === "expand_node" || scrapeCommand?.status === "running" ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : scrapeCommand?.status === "pending" ? (
                        <Clock3 className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <RefreshCw className="h-4 w-4" aria-hidden="true" />
                      )}
                      {scrapeCommand ? `${scrapeStatus.label}` : scrapeLabel}
                    </Button>
                  </div>
                ) : null}
              </div>
              {selectedCourse ? (
                <NodeDetails node={selectedCourse} clientReady={clientReady} />
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">Select a course to inspect it, expand it, or include it in an import.</p>
              )}
              {scrapeCommand ? <p className="text-xs text-muted-foreground">{scrapeStatus.detail}</p> : null}
            </div>

            {selectedCourse ? (
              <NodeList
                title="Course tabs"
                nodes={selectedCourse.children}
                selectedNodeId={selectedTab?.id ?? null}
                empty="Scrape tabs to inspect this course."
                onSelect={setSelectedNode}
                onToggle={toggleNode}
              />
            ) : null}

            {selectedTab ? (
              <div>
                <h2 className="text-sm font-medium">Selected tab preview</h2>
                <div className="mt-3">
                  <NodeDetails node={selectedTab} clientReady={clientReady} />
                </div>
              </div>
            ) : null}

            {selectedTab ? (
              <NodeList
                title={`${selectedTab.title} items`}
                nodes={selectedTab.children}
                selectedNodeId={selectedItem?.id ?? null}
                empty="Scrape items to inspect this tab."
                onSelect={setSelectedNode}
                onToggle={toggleNode}
              />
            ) : null}

            {selectedItem ? (
              <div>
                <h2 className="text-sm font-medium">Selected item</h2>
                <div className="mt-3">
                  <NodeDetails node={selectedItem} clientReady={clientReady} />
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  )
}
