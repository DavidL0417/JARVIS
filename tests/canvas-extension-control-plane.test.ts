import { describe, expect, it } from "vitest"

import {
  isCanvasExtensionImportSelectableNode,
  isNestedCanvasCourseHomeNode,
  isCanvasExtensionVisibleNode,
} from "@/lib/sources/canvas-extension-control"
import { classifySupabaseAuthError } from "@/lib/supabase/auth"
import {
  canvasExtensionCommandEventSchema,
  canvasExtensionImportPageRequestSchema,
  canvasExtensionPageSnapshotSchema,
  canvasExtensionCreateCommandRequestSchema,
  canvasExtensionStateResponseSchema,
  canvasExtensionWorkerReportRequestSchema,
} from "@/schemas/canvas-extension"

describe("Canvas extension control-plane schemas", () => {
  it("accepts app-created discovery, expansion, capture, import, stop, and resume commands", () => {
    expect(canvasExtensionCreateCommandRequestSchema.parse({ type: "discover" }).type).toBe("discover")
    expect(canvasExtensionCreateCommandRequestSchema.parse({
      type: "expand_node",
      targetNodeId: "11111111-1111-4111-8111-111111111111",
    }).type).toBe("expand_node")
    expect(canvasExtensionCreateCommandRequestSchema.parse({
      type: "capture_url",
      targetNodeId: "11111111-1111-4111-8111-111111111111",
      url: "https://canvas.example.edu/courses/42/pages/week-1",
    }).url).toBe("https://canvas.example.edu/courses/42/pages/week-1")
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
      level: "info",
      phase: "collect_items",
      nodeId: "22222222-2222-4222-8222-222222222222",
      message: "Expanded Modules.",
      details: { linkCount: 4 },
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
    expect(parsed.phase).toBe("collect_items")
  })

  it("accepts command events and derived state health", () => {
    const event = canvasExtensionCommandEventSchema.parse({
      id: "33333333-3333-4333-8333-333333333333",
      commandId: "11111111-1111-4111-8111-111111111111",
      userId: "44444444-4444-4444-8444-444444444444",
      level: "info",
      phase: "open_courses",
      nodeId: null,
      message: "Opening Canvas All Courses.",
      details: {},
      createdAt: "2026-05-19T18:00:00.000Z",
    })

    const parsed = canvasExtensionStateResponseSchema.parse({
      success: true,
      health: {
        authStatus: "signed_in",
        extensionStatus: "connected",
        activeCommand: null,
        lastEvent: event,
        recoverableActions: ["retry_state", "wake_extension"],
      },
      session: null,
      commands: [],
      nodes: [],
      events: [event],
    })

    expect(parsed.health.lastEvent?.phase).toBe("open_courses")
    expect(parsed.events).toHaveLength(1)
  })

  it("classifies Supabase auth connect timeouts as backend timeouts, not signed-out auth", () => {
    const timeoutError = Object.assign(new Error("fetch failed"), {
      cause: Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" }),
    })

    expect(classifySupabaseAuthError(timeoutError)).toBe("backend_timeout")
    expect(classifySupabaseAuthError({ status: 401, message: "JWT invalid" })).toBe("auth_required")
    expect(classifySupabaseAuthError({ name: "AuthSessionMissingError", message: "Auth session missing!" })).toBe("auth_required")
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
      pagePreview: {
        html: "<main><h1>Course 42</h1><a href=\"#\" data-jarvis-canvas-url=\"https://canvas.example.edu/courses/42/modules/items/7\">Week 1 PDF</a></main>",
        links: [
          {
            url: "https://canvas.example.edu/courses/42/modules/items/7",
            text: "Week 1 PDF",
          },
        ],
        blocks: [
          {
            id: "block-0-course-42",
            type: "links",
            title: "Course 42",
            text: "Course 42 Week 1 PDF",
            html: "<h1>Course 42</h1><a href=\"#\" data-jarvis-canvas-url=\"https://canvas.example.edu/courses/42/modules/items/7\">Week 1 PDF</a>",
            links: [
              {
                url: "https://canvas.example.edu/courses/42/modules/items/7",
                text: "Week 1 PDF",
              },
            ],
            order: 0,
          },
        ],
        capturedAt: "2026-05-18T20:00:00.000Z",
      },
      capturedAt: "2026-05-18T20:00:00.000Z",
    })

    expect(parsed.courseNavLinks?.[0].text).toBe("Modules")
    expect(parsed.pageItemLinks?.[0].text).toBe("Week 1 PDF")
    expect(parsed.pagePreview?.links[0].text).toBe("Week 1 PDF")
    expect(parsed.pagePreview?.blocks?.[0].type).toBe("links")
  })

  it("accepts both DOM snapshots and Canvas API content on the import-page request", () => {
    const snapshot = canvasExtensionImportPageRequestSchema.parse({
      scanId: "canvas-command-123456",
      canvasOrigin: "https://canvas.example.edu",
      url: "https://canvas.example.edu/courses/42/pages/week-1",
      title: "Week 1",
      courseHint: "Course 42",
      pageKindHint: "page",
      visibleText: "Week 1 reading",
      links: [],
      capturedAt: "2026-05-28T20:00:00.000Z",
    })
    expect("visibleText" in snapshot).toBe(true)

    const apiContent = canvasExtensionImportPageRequestSchema.parse({
      scanId: "canvas-command-123456",
      canvasOrigin: "https://canvas.example.edu",
      url: "https://canvas.example.edu/courses/42/pages/week-1",
      title: "Week 1",
      courseHint: "Course 42",
      pageKindHint: "page",
      apiSource: "page",
      nodeId: "11111111-1111-4111-8111-111111111111",
      contentHtml: "<h1>Week 1</h1><p>Read chapter 1.</p>",
      capturedAt: "2026-05-28T20:00:00.000Z",
    })
    expect("apiSource" in apiContent && apiContent.apiSource).toBe("page")
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

  it("rejects nested Canvas course-home links before they can overwrite root courses", () => {
    expect(isNestedCanvasCourseHomeNode({
      parentId: "22222222-2222-4222-8222-222222222222",
      parentUrl: null,
      url: "https://canvas.example.edu/courses/42",
    })).toBe(true)

    expect(isNestedCanvasCourseHomeNode({
      parentId: null,
      parentUrl: null,
      url: "https://canvas.example.edu/courses/42",
    })).toBe(false)

    expect(isNestedCanvasCourseHomeNode({
      parentId: "22222222-2222-4222-8222-222222222222",
      parentUrl: null,
      url: "https://canvas.example.edu/courses/42/assignments",
    })).toBe(false)

    expect(isNestedCanvasCourseHomeNode({
      parentId: "22222222-2222-4222-8222-222222222222",
      parentUrl: null,
      url: "https://canvas.example.edu/courses/42?view=feed",
    })).toBe(false)
  })
})
