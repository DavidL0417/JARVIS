import { describe, expect, it } from "vitest"

import {
  claimLine,
  claimNextCommand,
  completeCommand,
  enqueueCommand,
  enqueueConfirm,
  extractAckTokens,
  hashLineText,
  mapClaimedCommand,
  mintAckToken,
  normalizeLineText,
  recordCapture,
  renderConfirmText,
  validateCommandPayload,
} from "@/lib/jarvis-note/commands"
import type { RaycastItemPayload } from "@/schemas/raycast"

type Result = { data: unknown; error: unknown }
type ChainState = {
  table: string
  op: "insert" | "update" | "select" | null
  payload: Record<string, unknown> | null
  filters: Record<string, unknown>
  selected: string | null
}

// Minimal chainable stand-in for the Supabase admin client: records the chain and
// resolves terminals (single/maybeSingle) via the supplied resolvers.
function makeAdmin(opts: {
  calls: Array<ChainState | { rpc: string; args: Record<string, unknown> }>
  fromResolve?: (state: ChainState) => Result
  rpcResolve?: (name: string, args: Record<string, unknown>) => Result
}) {
  function builder(table: string) {
    const state: ChainState = { table, op: null, payload: null, filters: {}, selected: null }
    const b: Record<string, unknown> = {}
    const resolve = () => {
      opts.calls.push({ ...state, filters: { ...state.filters } })
      return Promise.resolve(opts.fromResolve ? opts.fromResolve(state) : { data: null, error: null })
    }
    b.insert = (payload: Record<string, unknown>) => ((state.op = "insert"), (state.payload = payload), b)
    b.update = (payload: Record<string, unknown>) => ((state.op = "update"), (state.payload = payload), b)
    b.select = (cols: string) => ((state.selected = cols), b)
    b.eq = (col: string, val: unknown) => ((state.filters[col] = val), b)
    b.is = (col: string, val: unknown) => ((state.filters[col] = val), b)
    b.single = resolve
    b.maybeSingle = resolve
    return b
  }
  return {
    from: (table: string) => builder(table),
    rpc: (name: string, args: Record<string, unknown>) => {
      opts.calls.push({ rpc: name, args })
      return Promise.resolve(opts.rpcResolve ? opts.rpcResolve(name, args) : { data: null, error: null })
    },
  } as never
}

const item = (o: Partial<RaycastItemPayload>): RaycastItemPayload => ({
  kind: "bullet",
  checked: null,
  text: "x",
  noteTitle: null,
  section: null,
  authored: "user",
  ...o,
})

describe("ack token helpers", () => {
  it("mints 8 lowercase-hex tokens that differ", () => {
    const a = mintAckToken()
    const b = mintAckToken()
    expect(a).toMatch(/^[0-9a-f]{8}$/)
    expect(b).toMatch(/^[0-9a-f]{8}$/)
    expect(a).not.toBe(b)
  })

  it("renders a confirm line that embeds the token and round-trips via extract", () => {
    const text = renderConfirmText("  mark MLM work done  ", "a1b2c3d4")
    expect(text).toBe("⚠️ Confirm: mark MLM work done? (#a1b2c3d4)")
    expect(extractAckTokens([item({ kind: "task", checked: true, text })])).toEqual(["a1b2c3d4"])
  })

  it("extracts tokens ONLY from ticked task lines", () => {
    const items = [
      item({ kind: "task", checked: true, text: "✅ done (#aaaaaaaa)" }),
      item({ kind: "task", checked: false, text: "⚠️ Confirm: x? (#bbbbbbbb)" }), // unticked
      item({ kind: "bullet", checked: null, text: "note (#cccccccc)" }), // not a task
      item({ kind: "task", checked: true, text: "no token here" }),
    ]
    expect(extractAckTokens(items)).toEqual(["aaaaaaaa"])
  })
})

describe("validateCommandPayload", () => {
  it("accepts a valid payload per kind", () => {
    expect(validateCommandPayload("append", { lines: ["📝 hi"] })).toEqual({ lines: ["📝 hi"] })
    expect(validateCommandPayload("confirm", { action: "do x" })).toMatchObject({ action: "do x" })
    expect(validateCommandPayload("delete_lines", { match: ["a"] })).toEqual({ match: ["a"] })
  })

  it("throws on a payload that doesn't match its kind", () => {
    expect(() => validateCommandPayload("append", { action: "x" })).toThrow()
    expect(() => validateCommandPayload("confirm", { lines: ["x"] })).toThrow()
    expect(() => validateCommandPayload("append", { lines: [] })).toThrow() // min 1
  })
})

describe("mapClaimedCommand", () => {
  it("maps snake_case row to the camelCase claimed command with defaults", () => {
    expect(
      mapClaimedCommand({ id: "id1", kind: "confirm", payload: { action: "x" }, requires_ack: true, ack_token: "t" }),
    ).toEqual({ id: "id1", kind: "confirm", payload: { action: "x" }, requiresAck: true, ackToken: "t" })
    expect(
      mapClaimedCommand({ id: "id2", kind: "append", payload: null, requires_ack: null, ack_token: null }),
    ).toEqual({ id: "id2", kind: "append", payload: {}, requiresAck: false, ackToken: null })
  })
})

describe("enqueueCommand / enqueueConfirm", () => {
  it("validates before inserting and writes the expected columns", async () => {
    const calls: Array<ChainState | { rpc: string; args: Record<string, unknown> }> = []
    const admin = makeAdmin({ calls, fromResolve: () => ({ data: { id: "cmd1" }, error: null }) })
    const out = await enqueueCommand(admin, "user-1", { kind: "append", payload: { lines: ["📝 hi"] } })
    expect(out).toEqual({ id: "cmd1" })
    const insert = calls.find((c): c is ChainState => "op" in c && c.op === "insert")!
    expect(insert.table).toBe("jarvis_note_commands")
    expect(insert.payload).toMatchObject({ user_id: "user-1", kind: "append", payload: { lines: ["📝 hi"] }, requires_ack: false, ack_token: null })
  })

  it("rejects an invalid payload BEFORE touching the DB", async () => {
    const calls: Array<ChainState | { rpc: string; args: Record<string, unknown> }> = []
    const admin = makeAdmin({ calls })
    await expect(enqueueCommand(admin, "user-1", { kind: "append", payload: { lines: [] } })).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })

  it("enqueueConfirm mints a token, marks requires_ack, and stores the rendered text", async () => {
    const calls: Array<ChainState | { rpc: string; args: Record<string, unknown> }> = []
    const admin = makeAdmin({ calls, fromResolve: () => ({ data: { id: "c9" }, error: null }) })
    const out = await enqueueConfirm(admin, "user-1", "mark MLM work done")
    expect(out.ackToken).toMatch(/^[0-9a-f]{8}$/)
    expect(out.confirmText).toBe(renderConfirmText("mark MLM work done", out.ackToken))
    const insert = calls.find((c): c is ChainState => "op" in c && c.op === "insert")!
    expect(insert.payload).toMatchObject({
      kind: "confirm",
      requires_ack: true,
      ack_token: out.ackToken,
      payload: { action: "mark MLM work done", confirmText: out.confirmText },
    })
  })
})

describe("claimNextCommand", () => {
  it("claims via the RPC (not select-then-update) and maps the row", async () => {
    const calls: Array<ChainState | { rpc: string; args: Record<string, unknown> }> = []
    const admin = makeAdmin({
      calls,
      rpcResolve: () => ({ data: { id: "c1", kind: "append", payload: { lines: ["📝 x"] }, requires_ack: false, ack_token: null }, error: null }),
    })
    const cmd = await claimNextCommand(admin, "user-1", "worker-7")
    const rpcCall = calls.find((c): c is { rpc: string; args: Record<string, unknown> } => "rpc" in c)!
    expect(rpcCall.rpc).toBe("claim_next_jarvis_note_command")
    expect(rpcCall.args).toEqual({ p_user_id: "user-1", p_worker: "worker-7" })
    expect(cmd).toEqual({ id: "c1", kind: "append", payload: { lines: ["📝 x"] }, requiresAck: false, ackToken: null })
    // never falls back to a select-then-update on the table
    expect(calls.some((c) => "table" in c)).toBe(false)
  })

  it("returns null on an empty queue", async () => {
    const admin = makeAdmin({ calls: [], rpcResolve: () => ({ data: null, error: null }) })
    expect(await claimNextCommand(admin, "user-1", "w")).toBeNull()
  })

  it("tolerates a single-row array return shape", async () => {
    const admin = makeAdmin({
      calls: [],
      rpcResolve: () => ({ data: [{ id: "c2", kind: "confirm", payload: {}, requires_ack: true, ack_token: "tk" }], error: null }),
    })
    expect(await claimNextCommand(admin, "user-1", "w")).toMatchObject({ id: "c2", ackToken: "tk", requiresAck: true })
  })
})

describe("completeCommand", () => {
  it("guards the update on status='claimed' and reports updated", async () => {
    const calls: Array<ChainState | { rpc: string; args: Record<string, unknown> }> = []
    const admin = makeAdmin({ calls, fromResolve: () => ({ data: { id: "c1" }, error: null }) })
    const out = await completeCommand(admin, "user-1", { commandId: "c1", status: "done", result: { rows: 1 } })
    expect(out).toEqual({ updated: true })
    const upd = calls.find((c): c is ChainState => "op" in c && c.op === "update")!
    expect(upd.filters).toMatchObject({ id: "c1", user_id: "user-1", status: "claimed" })
    expect(upd.payload).toMatchObject({ status: "done", result: { rows: 1 } })
  })

  it("reports updated:false when nothing matched (stale/duplicate report)", async () => {
    const admin = makeAdmin({ calls: [], fromResolve: () => ({ data: null, error: null }) })
    expect(await completeCommand(admin, "user-1", { commandId: "c1", status: "failed", error: "boom" })).toEqual({ updated: false })
  })
})

describe("recordCapture", () => {
  it("logs the capture and acks only the tokens whose command matched, idempotently", async () => {
    const calls: Array<ChainState | { rpc: string; args: Record<string, unknown> }> = []
    // 'aaaaaaaa' has an outstanding confirm (matches → data); 'bbbbbbbb' does not (null).
    const admin = makeAdmin({
      calls,
      fromResolve: (state) => {
        if (state.op === "insert") return { data: { id: "cap1" }, error: null }
        if (state.op === "update") return { data: state.filters.ack_token === "aaaaaaaa" ? { id: "cmdA" } : null, error: null }
        return { data: null, error: null }
      },
    })
    const out = await recordCapture(admin, "user-1", {
      noteMarkdown: "# JARVIS\n\n- [x] ✅ done (#aaaaaaaa)",
      contentHash: "h1",
      items: [
        item({ kind: "task", checked: true, text: "✅ done (#aaaaaaaa)" }),
      ],
      ackedTokens: ["bbbbbbbb"], // daemon-reported, plus 'aaaaaaaa' derived from items
      unchanged: false,
    })
    expect(out.captureId).toBe("cap1")
    expect(out.newlyAcked).toEqual(["aaaaaaaa"])

    // capture insert carried the unioned tokens
    const insert = calls.find((c): c is ChainState => "op" in c && c.op === "insert")!
    expect(insert.table).toBe("jarvis_note_captures")
    expect(insert.payload?.acked_tokens).toEqual(expect.arrayContaining(["aaaaaaaa", "bbbbbbbb"]))

    // every ack update is guarded: requires_ack=true AND acked_at is null
    const updates = calls.filter((c): c is ChainState => "op" in c && c.op === "update")
    expect(updates.length).toBe(2)
    for (const u of updates) {
      expect(u.table).toBe("jarvis_note_commands")
      expect(u.filters).toMatchObject({ user_id: "user-1", requires_ack: true, acked_at: null })
    }
  })
})

describe("normalizeLineText / hashLineText", () => {
  it("collapses whitespace so trivial diffs hash the same; real edits differ", () => {
    expect(normalizeLineText("  hello   world ")).toBe("hello world")
    expect(hashLineText("  hello   world ")).toBe(hashLineText("hello world"))
    expect(hashLineText("hello world")).not.toBe(hashLineText("hello worlds"))
  })
})

describe("claimLine", () => {
  it("claims via the windowed RPC and returns true when the RPC grants it", async () => {
    const calls: Array<ChainState | { rpc: string; args: Record<string, unknown> }> = []
    const admin = makeAdmin({ calls, rpcResolve: () => ({ data: true, error: null }) })
    expect(await claimLine(admin, "user-1", "  what's due?  ")).toBe(true)
    const rpc = calls.find((c): c is { rpc: string; args: Record<string, unknown> } => "rpc" in c)!
    expect(rpc.rpc).toBe("claim_jarvis_note_line")
    expect(rpc.args).toMatchObject({ p_user_id: "user-1", p_line_text: "what's due?" })
    expect(rpc.args.p_line_hash).toBe(hashLineText("what's due?"))
  })

  it("returns false when the RPC says it was claimed within the window", async () => {
    const admin = makeAdmin({ calls: [], rpcResolve: () => ({ data: false, error: null }) })
    expect(await claimLine(admin, "user-1", "dup line")).toBe(false)
  })

  it("never claims an empty/whitespace line and does not call the RPC", async () => {
    const calls: Array<ChainState | { rpc: string; args: Record<string, unknown> }> = []
    const admin = makeAdmin({ calls })
    expect(await claimLine(admin, "user-1", "   ")).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
