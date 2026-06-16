# Memory store: write-gate, consolidation, and lifecycle

Outcome of the Phase-1 memory-backend audit (2026-06-15) and the staged
stabilization that followed. Operator chose **STABILIZE** over re-architecting.

## What shipped

**Stage 1 — rigorous writes (one gate + a DB invariant).** `memory_items` had no
uniqueness on content, so all four write paths could insert duplicates and a
first-login seeding race did exactly that. Now a partial unique index
`memory_items_user_layer_content_key (user_id, layer, content_norm) where
status='active'` makes "the same fact at most once per (user, layer)" a table
invariant. `content_norm` is a deterministic generated column (lower + trim +
whitespace-collapse). Every writer goes through `insertMemoryItem`
(`lib/assistant/memory-write.ts`), which turns a `23505` into an idempotent
no-op. The hash is computed from the stored text deterministically — **not** from
`normalizeMemoryContent`, whose Haiku output is non-deterministic and would make
a content hash unenforceable.

**Stage 2 — consolidation (heal).** Read-time exact-dedupe in
`selectPlannerMemories` collapses same-text notes (including the same fact in two
layers, which the per-layer index allows). A daily job
(`/api/cron/memory-consolidate`, `consolidateMemoriesForUser`) uses an LLM judge
to retire **semantic** near-duplicates the index can't see, within a layer, via
`status='superseded'` + `supersedes_id` — the first real use of that dormant
column. Conservative by construction (`buildSupersedeOps` validates every
proposed merge) and change-logged.

**Stage 3 — lifecycle.** Reads now exclude expired notes
(`unexpiredOrFilter`: `expires_at IS NULL OR expires_at > now`), so a memory with
a passed expiry drops out of the planner/drawer/schedule without a sweeper.
Lifecycle states in use: `active` → `superseded` (consolidation) /
`archived` (user discard). Reads filter `status='active'`, so all non-active
states are excluded automatically.

## Deliberately deferred (decisions, not bugs)

- **Retire `kind`.** The 6-value `kind` enum is vestigial: no read branches on
  it, and `layer` + `category` carry the real signal. Dropping the column is a
  schema change with low payoff and some risk; left as-is for now.
- **`candidate_memories` status.** Source-candidate promotion lands rows in the
  `candidate_memories` layer with `status='active'`, despite the "candidate"
  name. Changing them to `status='candidate'` would hide promoted memories from
  every read (all filter `active`), so it needs an explicit approve-to-active
  step before it's worth doing.
- **Writing `expires_at` at runtime.** Nothing in the deployed app sets
  `expires_at` yet (only the offline seed script does). Enforcement is in place;
  populating it for time-bound memories (e.g. `deadline_context`) is the
  follow-on that makes it bite.
- **Expiry → status sweep.** Expired rows stay `status='active'` in the DB (just
  hidden from reads) and still occupy the unique index. A sweep flipping expired
  rows to `stale`/`archived` would finally use the `stale` status, but is moot
  until something writes `expires_at`.
