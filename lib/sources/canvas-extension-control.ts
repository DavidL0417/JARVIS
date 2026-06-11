import type { SupabaseClient } from "@supabase/supabase-js"

import type {
  CanvasExtensionCommand,
  CanvasExtensionCommandEvent,
  CanvasExtensionNode,
  CanvasExtensionSession,
} from "@/schemas/canvas-extension"

export const CANVAS_EXTENSION_SESSION_SELECT =
  "id, status, extension_version, canvas_origin, active_url, active_title, active_command_id, last_seen_at"
export const CANVAS_EXTENSION_COMMAND_SELECT =
  "id, type, status, target_node_id, payload, result, error_message, started_at, completed_at, created_at, updated_at"
export const CANVAS_EXTENSION_NODE_SELECT =
  "id, parent_id, canvas_origin, url, title, kind, text_preview, metadata, selected, expanded, imported_at, source_snapshot_id, source_file_id, discovered_at"
export const CANVAS_EXTENSION_COMMAND_EVENT_SELECT =
  "id, command_id, user_id, level, phase, node_id, message, details, created_at"

type AdminClient = SupabaseClient

interface CanvasExtensionSessionRow {
  id: string
  status: "connected" | "disconnected" | "error"
  extension_version: string | null
  canvas_origin: string | null
  active_url: string | null
  active_title: string | null
  active_command_id: string | null
  last_seen_at: string
}

interface CanvasExtensionCommandRow {
  id: string
  type: CanvasExtensionCommand["type"]
  status: CanvasExtensionCommand["status"]
  target_node_id: string | null
  payload: Record<string, unknown>
  result: Record<string, unknown>
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

interface CanvasExtensionNodeRow {
  id: string
  parent_id: string | null
  canvas_origin: string
  url: string
  title: string
  kind: CanvasExtensionNode["kind"]
  text_preview: string | null
  metadata: Record<string, unknown>
  selected: boolean
  expanded: boolean
  imported_at: string | null
  source_snapshot_id: string | null
  source_file_id: string | null
  discovered_at: string
}

type ExistingCanvasExtensionNodeRow = Pick<CanvasExtensionNodeRow, "url" | "selected" | "expanded" | "imported_at" | "source_snapshot_id" | "source_file_id">

interface CanvasExtensionCommandEventRow {
  id: string
  command_id: string | null
  user_id: string
  level: CanvasExtensionCommandEvent["level"]
  phase: string
  node_id: string | null
  message: string
  details: Record<string, unknown>
  created_at: string
}

export interface CanvasExtensionWorkerNodeInput {
  parentId?: string | null
  parentUrl?: string | null
  canvasOrigin: string
  url: string
  title: string
  kind: CanvasExtensionNode["kind"]
  textPreview?: string | null
  metadata?: Record<string, unknown>
  selected?: boolean
  expanded?: boolean
}

export function isCanvasExtensionVisibleNode(node: Pick<CanvasExtensionNode, "kind" | "parentId">) {
  return node.kind === "course" || Boolean(node.parentId)
}

export function isCanvasExtensionImportSelectableNode(node: Pick<CanvasExtensionNode, "kind" | "parentId" | "selected" | "importedAt">) {
  if (!node.selected || node.importedAt) return false
  return node.kind === "course" || Boolean(node.parentId)
}

export function canvasExtensionNodeLevel(node: Pick<CanvasExtensionNode, "kind" | "parentId" | "metadata">) {
  const level = node.metadata.level
  if (level === "course" || level === "tab" || level === "item") return level
  if (node.kind === "course") return "course"
  return node.parentId ? "item" : "tab"
}

export function canvasExtensionCourseIdFromUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.search) return null
    return url.pathname.match(/^\/courses\/(\d+)\/?$/)?.[1] ?? null
  } catch {
    return null
  }
}

export function isNestedCanvasCourseHomeNode(node: Pick<CanvasExtensionWorkerNodeInput, "parentId" | "parentUrl" | "url">) {
  return Boolean((node.parentId || node.parentUrl) && canvasExtensionCourseIdFromUrl(node.url))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function mapCanvasExtensionSession(row: CanvasExtensionSessionRow): CanvasExtensionSession {
  return {
    id: row.id,
    status: row.status,
    extensionVersion: row.extension_version,
    canvasOrigin: row.canvas_origin,
    activeUrl: row.active_url,
    activeTitle: row.active_title,
    activeCommandId: row.active_command_id,
    lastSeenAt: row.last_seen_at,
  }
}

export function mapCanvasExtensionCommand(row: CanvasExtensionCommandRow): CanvasExtensionCommand {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    targetNodeId: row.target_node_id,
    payload: asRecord(row.payload),
    result: asRecord(row.result),
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapCanvasExtensionNode(row: CanvasExtensionNodeRow): CanvasExtensionNode {
  return {
    id: row.id,
    parentId: row.parent_id,
    canvasOrigin: row.canvas_origin,
    url: row.url,
    title: row.title,
    kind: row.kind,
    textPreview: row.text_preview,
    metadata: asRecord(row.metadata),
    selected: row.selected,
    expanded: row.expanded,
    importedAt: row.imported_at,
    sourceSnapshotId: row.source_snapshot_id,
    sourceFileId: row.source_file_id,
    discoveredAt: row.discovered_at,
  }
}

export function mapCanvasExtensionCommandEvent(row: CanvasExtensionCommandEventRow): CanvasExtensionCommandEvent {
  return {
    id: row.id,
    commandId: row.command_id,
    userId: row.user_id,
    level: row.level,
    phase: row.phase,
    nodeId: row.node_id,
    message: row.message,
    details: asRecord(row.details),
    createdAt: row.created_at,
  }
}

export async function recordCanvasExtensionCommandEvent(input: {
  adminClient: AdminClient
  userId: string
  commandId?: string | null
  level?: CanvasExtensionCommandEvent["level"]
  phase?: string | null
  nodeId?: string | null
  message: string
  details?: Record<string, unknown>
}) {
  const { data, error } = await input.adminClient
    .from("canvas_extension_command_events")
    .insert({
      command_id: input.commandId ?? null,
      user_id: input.userId,
      level: input.level ?? "info",
      phase: input.phase || "status",
      node_id: input.nodeId ?? null,
      message: input.message,
      details: input.details ?? {},
    })
    .select(CANVAS_EXTENSION_COMMAND_EVENT_SELECT)
    .single()
    .returns<CanvasExtensionCommandEventRow>()

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to record Canvas extension command event.")
  }

  return mapCanvasExtensionCommandEvent(data)
}

export async function upsertCanvasExtensionNodes(input: {
  adminClient: AdminClient
  userId: string
  nodes: CanvasExtensionWorkerNodeInput[]
}) {
  const safeNodes = input.nodes.filter((node) => !isNestedCanvasCourseHomeNode(node))

  if (safeNodes.length === 0) {
    return []
  }

  const uniqueNodes = Array.from(new Map(safeNodes.map((node) => [`${node.canvasOrigin}|${node.url}`, node])).values())
  const upserted: CanvasExtensionNodeRow[] = []
  const existingUrls = uniqueNodes.map((node) => node.url)
  const existingResult = existingUrls.length > 0
    ? await input.adminClient
        .from("canvas_extension_nodes")
        .select("url, selected, expanded, imported_at, source_snapshot_id, source_file_id")
        .eq("user_id", input.userId)
        .in("url", existingUrls)
        .returns<ExistingCanvasExtensionNodeRow[]>()
    : { data: [], error: null }

  if (existingResult.error) {
    throw new Error(existingResult.error.message)
  }

  const existingByUrl = new Map((existingResult.data || []).map((row) => [row.url, row]))

  for (const pass of [false, true]) {
    const passNodes = uniqueNodes.filter((node) => pass ? Boolean(node.parentUrl || node.parentId) : !node.parentUrl && !node.parentId)
    if (passNodes.length === 0) continue

    const parentUrls = passNodes
      .map((node) => node.parentUrl)
      .filter((url): url is string => Boolean(url))
    const parentRows = parentUrls.length > 0
      ? await input.adminClient
          .from("canvas_extension_nodes")
          .select("id, url")
          .eq("user_id", input.userId)
          .in("url", parentUrls)
      : { data: [], error: null }

    if (parentRows.error) {
      throw new Error(parentRows.error.message)
    }

    const parentIdsByUrl = new Map((parentRows.data || []).map((row: { id: string; url: string }) => [row.url, row.id]))
    const rows = passNodes.map((node) => {
      const existing = existingByUrl.get(node.url)

      return {
        user_id: input.userId,
        parent_id: node.parentId ?? (node.parentUrl ? parentIdsByUrl.get(node.parentUrl) ?? null : null),
        canvas_origin: new URL(node.canvasOrigin).origin,
        url: node.url,
        title: node.title,
        kind: node.kind,
        text_preview: node.textPreview ?? null,
        metadata: node.metadata ?? {},
        selected: existing?.selected || node.selected || false,
        expanded: existing?.expanded || node.expanded || false,
        imported_at: existing?.imported_at ?? null,
        source_snapshot_id: existing?.source_snapshot_id ?? null,
        source_file_id: existing?.source_file_id ?? null,
        updated_at: new Date().toISOString(),
      }
    })

    const { data, error } = await input.adminClient
      .from("canvas_extension_nodes")
      .upsert(rows, { onConflict: "user_id,canvas_origin,url" })
      .select(CANVAS_EXTENSION_NODE_SELECT)
      .returns<CanvasExtensionNodeRow[]>()

    if (error) {
      throw new Error(error.message)
    }

    upserted.push(...(data || []))
  }

  return upserted.map(mapCanvasExtensionNode)
}

export async function deleteCanvasExtensionRootNonCourseNodes(input: {
  adminClient: AdminClient
  userId: string
  canvasOrigins: string[]
}) {
  const canvasOrigins = Array.from(new Set(input.canvasOrigins.map((origin) => new URL(origin).origin)))
  if (canvasOrigins.length === 0) return

  const { error } = await input.adminClient
    .from("canvas_extension_nodes")
    .delete()
    .eq("user_id", input.userId)
    .is("parent_id", null)
    .neq("kind", "course")
    .in("canvas_origin", canvasOrigins)

  if (error) {
    throw new Error(error.message)
  }
}

export async function deleteCanvasExtensionChildren(input: {
  adminClient: AdminClient
  userId: string
  parentNodeId: string
}) {
  const { error } = await input.adminClient
    .from("canvas_extension_nodes")
    .delete()
    .eq("user_id", input.userId)
    .eq("parent_id", input.parentNodeId)

  if (error) {
    throw new Error(error.message)
  }
}

// Delete a single Canvas node the user no longer wants (e.g. a bad capture). Page content
// rows cascade on the node FK; any stored original file is best-effort removed from storage.
export async function deleteCanvasExtensionNode(input: {
  adminClient: AdminClient
  userId: string
  nodeId: string
}): Promise<boolean> {
  const targetResult = await input.adminClient
    .from("canvas_extension_nodes")
    .select(CANVAS_EXTENSION_NODE_SELECT)
    .eq("user_id", input.userId)
    .eq("id", input.nodeId)
    .maybeSingle()

  if (targetResult.error) {
    throw new Error(targetResult.error.message)
  }
  if (!targetResult.data) {
    return false
  }

  // Never let "delete this reading" wipe a whole course's children.
  const node = mapCanvasExtensionNode(targetResult.data)
  if (node.kind === "course") {
    throw new Error("Courses can't be deleted from the reader.")
  }

  const storagePath = typeof node.metadata?.storagePath === "string" ? node.metadata.storagePath : null
  if (storagePath) {
    await input.adminClient.storage.from("source-originals").remove([storagePath]).catch(() => undefined)
  }

  const { error } = await input.adminClient
    .from("canvas_extension_nodes")
    .delete()
    .eq("user_id", input.userId)
    .eq("id", input.nodeId)

  if (error) {
    throw new Error(error.message)
  }

  return true
}

export async function updateCanvasExtensionNodeSelection(input: {
  adminClient: AdminClient
  userId: string
  nodeId: string
  selected: boolean
}) {
  const selectedByParent = input.selected

  const targetResult = await input.adminClient
    .from("canvas_extension_nodes")
    .select(CANVAS_EXTENSION_NODE_SELECT)
    .eq("user_id", input.userId)
    .eq("id", input.nodeId)
    .maybeSingle()

  if (targetResult.error) {
    throw new Error(targetResult.error.message)
  }

  if (!targetResult.data) return null

  const target = mapCanvasExtensionNode(targetResult.data)
  const descendantsResult = await input.adminClient
    .from("canvas_extension_nodes")
    .select(CANVAS_EXTENSION_NODE_SELECT)
    .eq("user_id", input.userId)

  if (descendantsResult.error) {
    throw new Error(descendantsResult.error.message)
  }

  const allNodes = (descendantsResult.data || []).map(mapCanvasExtensionNode)
  const childrenByParent = new Map<string, CanvasExtensionNode[]>()

  for (const node of allNodes) {
    if (!node.parentId) continue
    const children = childrenByParent.get(node.parentId) || []
    children.push(node)
    childrenByParent.set(node.parentId, children)
  }

  const descendants: CanvasExtensionNode[] = []
  const visit = (parentId: string) => {
    for (const child of childrenByParent.get(parentId) || []) {
      descendants.push(child)
      visit(child.id)
    }
  }
  visit(target.id)

  const now = new Date().toISOString()
  const updates = [
    { node: target, selectedByParent: false },
    ...descendants.map((node) => ({ node, selectedByParent })),
  ]

  let updatedTarget: CanvasExtensionNode | null = null

  for (const update of updates) {
    const { data, error } = await input.adminClient
      .from("canvas_extension_nodes")
      .update({
        selected: input.selected,
        metadata: {
          ...update.node.metadata,
          selectedByParent: update.selectedByParent,
        },
        updated_at: now,
      })
      .eq("user_id", input.userId)
      .eq("id", update.node.id)
      .select(CANVAS_EXTENSION_NODE_SELECT)
      .single()
      .returns<CanvasExtensionNodeRow>()

    if (error) {
      throw new Error(error.message)
    }

    if (data.id === target.id) {
      updatedTarget = mapCanvasExtensionNode(data)
    }
  }

  return updatedTarget ?? target
}
