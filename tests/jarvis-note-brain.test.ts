import { describe, expect, it } from "vitest"

import type { SecretaryIntent } from "@/lib/assistant/orchestrator"
import {
  confirmActionText,
  diffNewUserLines,
  isMutatingIntent,
  type JarvisBrainContext,
  replyAppendLine,
  runBrainOnCapture,
  userLinesFromItems,
} from "@/lib/jarvis-note/brain"

describe("intent classification helpers", () => {
  it("treats state-changing intents as mutating and read/answer intents as not", () => {
    expect(isMutatingIntent({ kind: "create_task", title: "x", priority: "medium" })).toBe(true)
    expect(isMutatingIntent({ kind: "remember", content: "x" })).toBe(true)
    expect(isMutatingIntent({ kind: "plan_day", command: "plan" })).toBe(true)
    expect(isMutatingIntent({ kind: "pause_automations", until: null, command: "pause" })).toBe(true)
    expect(isMutatingIntent({ kind: "answer" })).toBe(false)
    expect(isMutatingIntent({ kind: "read_messages", contactQuery: "Alan", command: "x" })).toBe(false)
    expect(isMutatingIntent({ kind: "refresh_sources", command: "x" })).toBe(false)
  })

  it("summarizes a confirm action per intent, falling back to the raw line", () => {
    expect(confirmActionText("add a task to email Dana", { kind: "create_task", title: "email Dana", priority: "medium" })).toBe(
      'add task "email Dana"',
    )
    expect(confirmActionText("pause updates", { kind: "pause_automations", until: null, command: "pause" })).toBe("pause automations")
    expect(confirmActionText("do the weird thing", { kind: "answer" })).toBe("do the weird thing")
  })

  it("renders a reply as a single icon-tagged line", () => {
    expect(replyAppendLine("Added  \"x\".\nDone")).toBe('📝 Added "x". Done')
  })
})

describe("diffNewUserLines / userLinesFromItems", () => {
  it("returns only lines not in the previous capture, de-duped", () => {
    expect(diffNewUserLines(["a", "b", "b", "c"], ["a"])).toEqual(["b", "c"])
    expect(diffNewUserLines(["  a  "], ["a"])).toEqual([]) // trimmed match
    expect(diffNewUserLines([], ["a"])).toEqual([])
  })

  it("keeps only David's (non-agent) lines", () => {
    expect(
      userLinesFromItems([
        { text: "my task", authored: "user" },
        { text: "📝 my reply", authored: "agent" },
        { text: "  ", authored: "user" }, // blank dropped
        { text: "another", authored: null }, // null treated as user
      ]),
    ).toEqual(["my task", "another"])
  })
})

// ── orchestration ────────────────────────────────────────────────────────────
function makeCtx(overrides: Partial<JarvisBrainContext> & { intents?: Record<string, SecretaryIntent> } = {}) {
  const calls = {
    answered: [] as string[],
    appended: [] as Array<{ line: string; parentText?: string }>,
    confirms: [] as Array<{ action: string; sourceLine: string }>,
    deletes: [] as string[][],
  }
  const claimed = new Set<string>()
  const ctx: JarvisBrainContext = {
    classifyIntent: async (line) => overrides.intents?.[line] ?? { kind: "answer" },
    answer: async (line) => {
      calls.answered.push(line)
      return { reply: `did: ${line}`, ok: true }
    },
    appendLine: async (line, parentText) => {
      calls.appended.push({ line, parentText })
    },
    enqueueConfirm: async (action, sourceLine) => {
      calls.confirms.push({ action, sourceLine })
    },
    hasOpenConfirm: overrides.hasOpenConfirm ?? (async () => false),
    ackedConfirms: overrides.ackedConfirms ?? (async () => []),
    deleteLines: async (match) => {
      calls.deletes.push(match)
    },
    // default: claim each normalized line once (true first time, false after) — models
    // the windowed claim for the dedup tests.
    claimLine: overrides.claimLine ?? (async (line) => {
      const key = line.replace(/\s+/g, " ").trim()
      if (!key || claimed.has(key)) return false
      claimed.add(key)
      return true
    }),
  }
  return { ctx, calls }
}

describe("runBrainOnCapture", () => {
  it("answers a read/answer line directly and appends the reply", async () => {
    const { ctx, calls } = makeCtx({ intents: { "what's due tomorrow": { kind: "answer" } } })
    const result = await runBrainOnCapture(ctx, {
      currentUserLines: ["what's due tomorrow"],
      previousUserLines: [],
      ackedTokens: [],
    })
    expect(result.answered).toEqual(["what's due tomorrow"])
    expect(result.confirmed).toEqual([])
    expect(calls.answered).toEqual(["what's due tomorrow"])
    // the reply threads UNDER the question
    expect(calls.appended).toEqual([{ line: "📝 did: what's due tomorrow", parentText: "what's due tomorrow" }])
  })

  it("gates a mutating line behind a confirm — no action taken yet", async () => {
    const { ctx, calls } = makeCtx({
      intents: { "add a task to email Dana": { kind: "create_task", title: "email Dana", priority: "medium" } },
    })
    const result = await runBrainOnCapture(ctx, {
      currentUserLines: ["add a task to email Dana"],
      previousUserLines: [],
      ackedTokens: [],
    })
    expect(result.confirmed).toEqual(["add a task to email Dana"])
    expect(result.answered).toEqual([])
    expect(calls.confirms).toEqual([{ action: 'add task "email Dana"', sourceLine: "add a task to email Dana" }])
    expect(calls.answered).toEqual([]) // the mutation did NOT run
  })

  it("does not re-enqueue a confirm when one is already open for the line", async () => {
    const { ctx, calls } = makeCtx({
      intents: { "remember the gate code": { kind: "remember", content: "the gate code" } },
      hasOpenConfirm: async () => true,
    })
    const result = await runBrainOnCapture(ctx, {
      currentUserLines: ["remember the gate code"],
      previousUserLines: [],
      ackedTokens: [],
    })
    expect(result.confirmed).toEqual([])
    expect(calls.confirms).toEqual([])
  })

  it("only processes lines new since the previous capture", async () => {
    const { ctx, calls } = makeCtx()
    await runBrainOnCapture(ctx, {
      currentUserLines: ["old line", "brand new line"],
      previousUserLines: ["old line"],
      ackedTokens: [],
    })
    expect(calls.answered).toEqual(["brand new line"])
  })

  it("on ack: runs the deferred action, appends the result, and deletes both lines", async () => {
    const { ctx, calls } = makeCtx({
      ackedConfirms: async (tokens) =>
        tokens.includes("tok1")
          ? [{ sourceLine: "check off the MLM work", confirmText: "⚠️ Confirm: mark it done? (#tok1)" }]
          : [],
    })
    const result = await runBrainOnCapture(ctx, {
      currentUserLines: [],
      previousUserLines: [],
      ackedTokens: ["tok1"],
    })
    expect(result.executed).toEqual(["check off the MLM work"])
    expect(calls.answered).toEqual(["check off the MLM work"]) // deferred action ran now
    expect(calls.appended).toEqual([{ line: "📝 did: check off the MLM work", parentText: undefined }])
    expect(calls.deletes).toEqual([["⚠️ Confirm: mark it done? (#tok1)", "check off the MLM work"]])
  })

  it("does not answer a line that the claim rejects (idempotency gate)", async () => {
    const { ctx, calls } = makeCtx({ claimLine: async () => false })
    const result = await runBrainOnCapture(ctx, { currentUserLines: ["already answered"], previousUserLines: [], ackedTokens: [] })
    expect(result.answered).toEqual([])
    expect(calls.answered).toEqual([])
  })

  it("answers a line only once across two overlapping captures sharing a baseline", async () => {
    const { ctx, calls } = makeCtx()
    const input = { currentUserLines: ["what's due"], previousUserLines: [], ackedTokens: [] }
    await runBrainOnCapture(ctx, input)
    await runBrainOnCapture(ctx, input) // same stale baseline — the race the claim closes
    expect(calls.answered).toEqual(["what's due"]) // exactly once
  })

  it("gates the confirm branch on the claim too", async () => {
    const { ctx, calls } = makeCtx({
      intents: { "add task X": { kind: "create_task", title: "X", priority: "medium" } },
      claimLine: async () => false,
    })
    await runBrainOnCapture(ctx, { currentUserLines: ["add task X"], previousUserLines: [], ackedTokens: [] })
    expect(calls.confirms).toEqual([])
  })
})
