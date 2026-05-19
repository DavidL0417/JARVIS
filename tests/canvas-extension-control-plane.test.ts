import { describe, expect, it } from "vitest"

import {
  isCanvasExtensionImportSelectableNode,
  isCanvasExtensionVisibleNode,
} from "@/lib/sources/canvas-extension-control"
import {
  canvasExtensionPageSnapshotSchema,
  canvasExtensionCreateCommandRequestSchema,
  canvasExtensionWorkerReportRequestSchema,
} from "@/schemas/canvas-extension"

describe("Canvas extension control-plane schemas", () => {
  it("accepts app-created discovery, expansion, import, stop, and resume commands", () => {
    expect(canvasExtensionCreateCommandRequestSchema.parse({ type: "discover" }).type).toBe("discover")
    expect(canvasExtensionCreateCommandRequestSchema.parse({
      type: "expand_node",
      targetNodeId: "11111111-1111-4111-8111-111111111111",
    }).type).toBe("expand_node")
    expect(canvasExtensionCreateCommandRequestSchema.parse({
      type: "import_selected",
      nodeIds: ["11111111-1111-4111-8111-111111111111"],
    }).type).toBe("import_selected")
    expect(canvasExtensionCreateCommandRequestSchema.parse({ type: "stop" }).type).toBe("stop")
    expect(canvasExtensionCreateCommandRequestSchema.parse({ type: "resume" }).type).toBe("resume")
  })

  it("accepts worker progress reports with nested Canvas nodes", () => {
    const parsed = canvasExtensionWorkerReportRequestSchema.parse({
      commandId: "11111111-1111-4111-8111-111111111111",
      status: "progress",
      message: "Expanded Modules.",
      nodes: [
        {
          parentId: "22222222-2222-4222-8222-222222222222",
          canvasOrigin: "https://canvas.example.edu",
          url: "https://canvas.example.edu/courses/42/modules",
          title: "Modules",
          kind: "module",
        },
      ],
    })

    expect(parsed.nodes?.[0].kind).toBe("module")
  })

  it("accepts page snapshots with Canvas course navigation links", () => {
    const parsed = canvasExtensionPageSnapshotSchema.parse({
      scanId: "canvas-command-123456",
      canvasOrigin: "https://canvas.example.edu",
      url: "https://canvas.example.edu/courses/42",
      title: "Course 42",
      courseHint: "Course 42",
      pageKindHint: "course",
      visibleText: "Course home",
      links: [],
      courseNavLinks: [
        {
          url: "https://canvas.example.edu/courses/42/modules",
          text: "Modules",
          kindHint: null,
        },
      ],
      pageItemLinks: [
        {
          url: "https://canvas.example.edu/courses/42/modules/items/7",
          text: "Week 1 PDF",
          kindHint: null,
        },
      ],
      capturedAt: "2026-05-18T20:00:00.000Z",
    })

    expect(parsed.courseNavLinks?.[0].text).toBe("Modules")
    expect(parsed.pageItemLinks?.[0].text).toBe("Week 1 PDF")
  })

  it("keeps only courses and nested nodes visible in the control plane", () => {
    expect(isCanvasExtensionVisibleNode({ kind: "course", parentId: null })).toBe(true)
    expect(isCanvasExtensionVisibleNode({ kind: "assignment", parentId: "22222222-2222-4222-8222-222222222222" })).toBe(true)
    expect(isCanvasExtensionVisibleNode({ kind: "assignment", parentId: null })).toBe(false)
    expect(isCanvasExtensionVisibleNode({ kind: "file", parentId: null })).toBe(false)
  })

  it("excludes hidden stale root nodes from selected imports", () => {
    expect(isCanvasExtensionImportSelectableNode({
      kind: "assignment",
      parentId: null,
      selected: true,
      importedAt: null,
    })).toBe(false)
    expect(isCanvasExtensionImportSelectableNode({
      kind: "assignment",
      parentId: "22222222-2222-4222-8222-222222222222",
      selected: true,
      importedAt: null,
    })).toBe(true)
    expect(isCanvasExtensionImportSelectableNode({
      kind: "course",
      parentId: null,
      selected: true,
      importedAt: null,
    })).toBe(true)
  })
})
