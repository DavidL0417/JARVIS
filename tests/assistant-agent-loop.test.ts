import { afterEach, describe, expect, it, vi } from "vitest"

import type { AssistantRuntimeContext } from "../lib/assistant/context"
import { getAgentTools, isToolAllowedForSurface } from "../lib/assistant/agent/tools"

// Control the Anthropic SDK and the tool executors from the test, so we exercise
// the loop's mechanics (tool_use → tool_result → end_turn, receipts, needsRefresh)
// without hitting Claude or the database.
const { createMock, executeMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  executeMock: vi.fn(),
}))

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock }
  },
}))

vi.mock("@/lib/assistant/agent/executors", () => ({
  executeAgentTool: executeMock,
}))

// Imported AFTER the mocks are registered.
const { runAssistantAgentLoop } = await import("../lib/assistant/agent/loop")

const runtime = {
  tasks: [],
  events: [],
  latestDailyPlan: null,
  pendingCandidateCount: 0,
  context: {
    availability: { timezone: "America/Chicago", availabilitySummary: "none" },
    memorySummary: "none",
    sourceSnapshots: [],
  },
} as unknown as AssistantRuntimeContext

function baseInput(message: string, surface: "interactive" | "note" = "interactive") {
  return {
    supabase: {} as never,
    userId: "user-1",
    message,
    now: "2026-06-19T16:00:00.000Z",
    timezone: "America/Chicago",
    history: [],
    runtime,
    surface,
  }
}

describe("agent tool surface gating", () => {
  it("offers write + external tools on the interactive surface", () => {
    const names = getAgentTools("interactive").map((tool) => tool.name)
    expect(names).toContain("find_tasks")
    expect(names).toContain("update_task")
    expect(names).toContain("sync_tasks_to_google")
  })

  it("offers only read tools on the note surface", () => {
    const names = getAgentTools("note").map((tool) => tool.name)
    expect(names).toContain("find_tasks")
    expect(names).toContain("search_gmail")
    expect(names).not.toContain("update_task")
    expect(names).not.toContain("create_task")
    expect(names).not.toContain("sync_tasks_to_google")
  })

  it("permits writes only on interactive, reads on both", () => {
    expect(isToolAllowedForSurface("update_task", "interactive")).toBe(true)
    expect(isToolAllowedForSurface("update_task", "note")).toBe(false)
    expect(isToolAllowedForSurface("find_tasks", "note")).toBe(true)
    expect(isToolAllowedForSurface("nonsense", "interactive")).toBe(false)
  })
})

describe("runAssistantAgentLoop", () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it("fails clearly when Claude is not configured", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "")
    const result = await runAssistantAgentLoop(baseInput("change the dinner task"))
    expect(result.ok).toBe(false)
    expect(result.error).toContain("ANTHROPIC_API_KEY")
    expect(createMock).not.toHaveBeenCalled()
  })

  it("executes a tool call, then returns the model's closing text and a write receipt", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key")

    createMock
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          { type: "text", text: "Let me update that." },
          { type: "tool_use", id: "tu_1", name: "update_task", input: { taskId: "t1", title: "Dinner & Improv" } },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Renamed it to Dinner & Improv." }],
      })

    executeMock.mockResolvedValueOnce({
      resultForModel: { ok: true },
      receipt: { id: "r1", tool: "update_task", status: "completed", summary: "Updated the task." },
      didWrite: true,
    })

    const result = await runAssistantAgentLoop(baseInput("rename the dinner task to Dinner & Improv"))

    expect(result.ok).toBe(true)
    expect(result.reply).toBe("Renamed it to Dinner & Improv.")
    expect(result.needsRefresh).toBe(true)
    expect(result.receipts).toHaveLength(1)
    expect(result.receipts[0].result.tool).toBe("update_task")

    // The executor was dispatched with the model's tool name + input.
    expect(executeMock).toHaveBeenCalledTimes(1)
    expect(executeMock.mock.calls[0][0]).toBe("update_task")
    expect(executeMock.mock.calls[0][1]).toEqual({ taskId: "t1", title: "Dinner & Improv" })

    // Two model turns: the tool call, then the closing summary.
    expect(createMock).toHaveBeenCalledTimes(2)
    // The second turn carried the tool_result back to the model.
    const secondMessages = createMock.mock.calls[1][0].messages
    const toolResultTurn = secondMessages.find(
      (m: { role: string; content: unknown }) =>
        Array.isArray(m.content) && m.content.some((b: { type: string }) => b.type === "tool_result"),
    )
    expect(toolResultTurn).toBeTruthy()
  })

  it("carries an external-write approval payload through the receipt", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key")

    createMock
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_2", name: "sync_tasks_to_google", input: {} }],
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Queued a Google Calendar sync for your approval." }],
      })

    executeMock.mockResolvedValueOnce({
      resultForModel: { queued: true },
      receipt: { id: "r2", tool: "google_task_event_sync", status: "pending_approval", summary: "Prepared a sync.", requiresApproval: true },
      payload: { action: "google_task_event_sync", command: "push my blocks" },
      didWrite: false,
    })

    const result = await runAssistantAgentLoop(baseInput("push my blocks to google calendar"))

    expect(result.ok).toBe(true)
    expect(result.needsRefresh).toBe(false)
    expect(result.receipts[0].result.status).toBe("pending_approval")
    expect(result.receipts[0].payload).toEqual({ action: "google_task_event_sync", command: "push my blocks" })
  })
})
