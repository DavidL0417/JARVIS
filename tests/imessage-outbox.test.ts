import { describe, expect, it } from "vitest"

import {
  claimNextOutboxMessage,
  completeOutboxMessage,
  enqueueOutboxMessage,
} from "@/lib/imessage/outbox"

type Result = { data: unknown; error: unknown }
type ChainState = {
  table: string
  op: "insert" | "update" | "select" | null
  payload: Record<string, unknown> | null
  filters: Record<string, unknown>
  selected: string | null
}

// Minimal chainable stand-in for the Supabase admin client (mirrors the harness in
// jarvis-note-commands.test.ts): records the chain and resolves terminals
// (single/maybeSingle) via the supplied resolvers.
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

describe("enqueueOutboxMessage", () => {
  it("writes the expected columns and returns the new id", async () => {
    const calls: Array<ChainState | { rpc: string; args: Record<string, unknown> }> = []
    const admin = makeAdmin({ calls, fromResolve: () => ({ data: { id: "m1" }, error: null }) })
    const out = await enqueueOutboxMessage(admin, "user-1", {
      toHandle: "+15551234567",
      body: "hi",
      kind: "morning_digest",
      dedupKey: "morning_digest:2026-06-21",
      context: { taskIds: ["t1"] },
    })
    expect(out).toEqual({ id: "m1", deduped: false })
    const insert = calls.find((c): c is ChainState => "op" in c && c.op === "insert")!
    expect(insert.table).toBe("imessage_outbox")
    expect(insert.payload).toMatchObject({
      user_id: "user-1",
      to_handle: "+15551234567",
      body: "hi",
      kind: "morning_digest",
      dedup_key: "morning_digest:2026-06-21",
      context: { taskIds: ["t1"] },
    })
  })

  it("treats a unique-violation (23505) on the dedup key as an idempotent no-op", async () => {
    const admin = makeAdmin({
      calls: [],
      fromResolve: () => ({ data: null, error: { code: "23505", message: "duplicate key" } }),
    })
    const out = await enqueueOutboxMessage(admin, "user-1", {
      toHandle: "h",
      body: "b",
      kind: "evening_digest",
      dedupKey: "evening_digest:2026-06-21",
    })
    expect(out).toEqual({ id: null, deduped: true })
  })

  it("throws on any non-dedup DB error", async () => {
    const admin = makeAdmin({
      calls: [],
      fromResolve: () => ({ data: null, error: { code: "42501", message: "permission denied" } }),
    })
    await expect(
      enqueueOutboxMessage(admin, "user-1", { toHandle: "h", body: "b", kind: "manual" }),
    ).rejects.toThrow("permission denied")
  })

  it("defaults dedup_key + context when omitted (replies/manual have no dedup)", async () => {
    const calls: Array<ChainState | { rpc: string; args: Record<string, unknown> }> = []
    const admin = makeAdmin({ calls, fromResolve: () => ({ data: { id: "m2" }, error: null }) })
    await enqueueOutboxMessage(admin, "user-1", { toHandle: "h", body: "b", kind: "reply" })
    const insert = calls.find((c): c is ChainState => "op" in c && c.op === "insert")!
    expect(insert.payload).toMatchObject({ dedup_key: null, context: {} })
  })
})

describe("claimNextOutboxMessage", () => {
  it("claims via the RPC (not select-then-update) and maps the row to camelCase", async () => {
    const calls: Array<ChainState | { rpc: string; args: Record<string, unknown> }> = []
    const admin = makeAdmin({
      calls,
      rpcResolve: () => ({
        data: { id: "m1", to_handle: "+15551234567", body: "hi", kind: "morning_digest" },
        error: null,
      }),
    })
    const msg = await claimNextOutboxMessage(admin, "user-1", "worker-7")
    const rpcCall = calls.find((c): c is { rpc: string; args: Record<string, unknown> } => "rpc" in c)!
    expect(rpcCall.rpc).toBe("claim_next_imessage_outbox_command")
    expect(rpcCall.args).toEqual({ p_user_id: "user-1", p_worker: "worker-7" })
    expect(msg).toEqual({ id: "m1", toHandle: "+15551234567", body: "hi", kind: "morning_digest" })
    // never falls back to a select-then-update on the table
    expect(calls.some((c) => "table" in c)).toBe(false)
  })

  it("returns null on an empty queue", async () => {
    const admin = makeAdmin({ calls: [], rpcResolve: () => ({ data: null, error: null }) })
    expect(await claimNextOutboxMessage(admin, "user-1", "w")).toBeNull()
  })

  it("returns null for an empty array (SETOF empty) and tolerates a single-row array", async () => {
    const empty = makeAdmin({ calls: [], rpcResolve: () => ({ data: [], error: null }) })
    expect(await claimNextOutboxMessage(empty, "user-1", "w")).toBeNull()

    const oneRow = makeAdmin({
      calls: [],
      rpcResolve: () => ({ data: [{ id: "m2", to_handle: "h", body: "b", kind: "test" }], error: null }),
    })
    expect(await claimNextOutboxMessage(oneRow, "user-1", "w")).toEqual({
      id: "m2",
      toHandle: "h",
      body: "b",
      kind: "test",
    })
  })
})

describe("completeOutboxMessage", () => {
  it("guards the update on status='claimed', stamps sent_at on success, reports updated", async () => {
    const calls: Array<ChainState | { rpc: string; args: Record<string, unknown> }> = []
    const admin = makeAdmin({ calls, fromResolve: () => ({ data: { id: "m1" }, error: null }) })
    const out = await completeOutboxMessage(admin, "user-1", {
      messageId: "m1",
      status: "sent",
      result: { service: "iMessage" },
    })
    expect(out).toEqual({ updated: true })
    const upd = calls.find((c): c is ChainState => "op" in c && c.op === "update")!
    expect(upd.filters).toMatchObject({ id: "m1", user_id: "user-1", status: "claimed" })
    expect(upd.payload).toMatchObject({ status: "sent", result: { service: "iMessage" } })
    expect(upd.payload?.sent_at).toEqual(expect.any(String))
  })

  it("leaves sent_at null on failure and still guards on claimed", async () => {
    const calls: Array<ChainState | { rpc: string; args: Record<string, unknown> }> = []
    const admin = makeAdmin({ calls, fromResolve: () => ({ data: { id: "m1" }, error: null }) })
    await completeOutboxMessage(admin, "user-1", { messageId: "m1", status: "failed", error: "boom" })
    const upd = calls.find((c): c is ChainState => "op" in c && c.op === "update")!
    expect(upd.payload).toMatchObject({ status: "failed", error: "boom", sent_at: null })
  })

  it("reports updated:false when nothing matched (stale/duplicate report)", async () => {
    const admin = makeAdmin({ calls: [], fromResolve: () => ({ data: null, error: null }) })
    expect(
      await completeOutboxMessage(admin, "user-1", { messageId: "m1", status: "sent" }),
    ).toEqual({ updated: false })
  })
})
