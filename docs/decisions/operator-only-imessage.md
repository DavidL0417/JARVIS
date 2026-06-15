# Operator-only iMessage console — a deliberately hidden, single-user feature

**For future agents: this feature is intentional and single-user. It is invisible
to every account except the operator's.** It started (2026-06-13) as a headless
intake with no UI at all; on 2026-06-15 it deliberately grew an **operator-only
console UI**, a **curated contact allowlist**, and a **full-message archive**. That
growth was intentional — do **not** "revert" it back to headless, and do **not**
generalize it into a public connector or remove the operator gate. It exists so the
operator (David) can feed his own iMessage/SMS into JARVIS for scheduler candidates
**and** so the assistant can read his archived conversations ("what did Alan say?").
No other user is meant to discover or use it.

## What it does

macOS keeps every iMessage and SMS (when Text Message Forwarding is on) in a
local SQLite database at `~/Library/Messages/chat.db`. A local reader on the
operator's Mac — [`scripts/imessage/read-chat-db.mjs`](../../scripts/imessage/read-chat-db.mjs) —
snapshots that DB, decodes recent messages, **filters them locally** against the
operator's allowlist, and POSTs the survivors to
`POST /api/integrations/imessage/ingest`. The route:

1. **Archives** every message in full into `app_private.imessage_messages` (idempotent
   on guid) so the assistant can retrieve real conversations later, then
2. runs them through the **same extraction → candidate → auto-approve pipeline as
   Gmail** ([`extractCandidatesFromText`](../../lib/sources/extraction.ts)), so texts
   become scheduler candidates behind the normal approval gate.

Snapshots are labeled with source provenance `imessage`.

The product value: texts are the richest untapped source of *soft commitments*
("can you send me the deck by Friday") that a secretary should catch — and, with the
archive, the assistant can answer questions about what was actually said.

## Filtering, archive, and the console (added 2026-06-15)

- **Allowlist filtering happens on the Mac, before anything is sent.** The reader
  fetches the operator's allowlist from `GET /api/integrations/imessage/filter-config`
  (bearer-authed with the same `IMESSAGE_INGEST_SECRET`), then includes a chat only
  if it contains an allowlisted contact (1:1 **or** group), **or** it is a 1:1 with a
  non-shortcode handle and real two-way traffic in the last 30 days. Shortcodes
  (<7-digit senders: banks, 2FA, delivery, payment) and groups with no allowlisted
  member are dropped locally — their bodies never leave the machine. Logic mirrors the
  Scheduler's `messages_snapshot.py`; the shared primitives live in
  [`lib/imessage/handles.ts`](../../lib/imessage/handles.ts) (normalize + shortcode).
- **The full-message archive** (`app_private.imessage_messages`) stores body, handle,
  normalized handle, direction, timestamp, service, chat name, and is_group. A 1:1
  thread's messages are all tagged with the counterpart's normalized handle (both
  directions) so the whole conversation is retrievable by one key. Backfill the
  history with `--backfill --since-days N` (the cursor only governs what's *sent*, not
  what *exists* — chat.db holds full history).
- **The operator console** is a connector pane in the dashboard Sources sidebar,
  shown only when the dashboard payload's `isImessageOperator` is true. It is an
  allowlist editor (add/remove contacts by name + handle). Every allowlist endpoint
  re-checks the operator server-side and 404s otherwise — hiding the pane is cosmetic,
  the server 404 is the real lock.
- **Assistant retrieval**: the orchestrator detects "what did X say / read my messages
  with X" (`read_messages` intent), resolves the contact against the allowlist, loads
  the recent thread from the archive, and feeds it to the secretary dialogue model.

## Why it stays operator-only (and not a public connector)

The Apple Reminders integration is the closest sibling, but iMessage is deliberately
**more locked-down** than it:

| | Apple Reminders | iMessage (this) |
|---|---|---|
| Visible to | any signed-in user | **operator only** (`isImessageOperator`) |
| Connector card in UI | yes, public | **yes, but operator-gated** |
| Per-user onboarding | yes | **no — single operator** |
| Auth (device → server) | per-user bearer token | **shared env secret, pinned to one user id** |
| Stores raw message bodies | no | **yes (operator's own archive)** |
| Who can enable | any signed-in user | **only whoever sets the env vars** |

Rationale:

- **Operator-pinned + env-gated.** Two env vars gate everything:
  - `IMESSAGE_INGEST_SECRET` — the bearer secret the local reader sends (used by both
    `/ingest` and `/filter-config`).
  - `IMESSAGE_OPERATOR_USER_ID` — the single profile id every ingested message is
    written to, and the id the dashboard/allowlist routes compare the session user
    against. Even if the endpoint and secret leaked, ingest only ever writes to the
    operator's account.
  This mirrors the existing operator-only precedent (`AUTOMATION_OWNER_USER_ID` +
  `AUTOMATION_STATUS_TOKEN` in [automation-pause.md](./automation-pause.md)).
- **404 on every failure.** When either env var is unset, or the token/session is
  missing/wrong, every route returns a 404 indistinguishable from a non-existent
  route ([`requireImessageOperator`](../../lib/imessage/operator-auth.ts) for the
  reader, [`requireImessageOperatorSession`](../../lib/imessage/operator-session.ts)
  for the UI). In any deployment that hasn't opted in, the feature does not exist.

## Why a local reader (and not server-side, and not mobile)

- **iOS gives third-party apps zero access to Messages** — no public API, full
  sandbox, no App Store path. So phone-only / Android users cannot be served, ever.
  This is Mac-only by physics, which is fine: it's a single-operator feature.
- The requirement isn't "messages sent from a Mac" — it's "the operator owns a
  Mac." With Messages in iCloud on, phone-originated texts sync into the Mac's
  `chat.db`, so the reader captures them too.
- The reader needs **Full Disk Access** granted to its terminal/node process
  (`~/Library/Messages` is TCC-protected).
- Modern macOS often leaves `message.text` NULL and stores the body in
  `attributedBody` (a serialized `NSAttributedString`/typedstream blob); the reader
  decodes it best-effort. Dates are Apple-epoch nanoseconds since 2001-01-01.

## Privacy stance

The other party in every conversation never consented to being scraped or archived.
This is acceptable **only** because it is the operator's own data on the operator's
own machine for the operator's own use. It must **not** be generalized to other users.
Filtering happens on the Mac specifically so that non-allowlisted people's bodies
never reach the server. If this were ever generalized, the model would have to change
to local-only extraction that ships structured signals (a task, a date) and never raw
message bodies.

## Operating it

1. **DB migrations** —
   [`20260613153000_imessage_operator_ingest.sql`](../../supabase/migrations/20260613153000_imessage_operator_ingest.sql)
   widens the source-provenance CHECK constraints to allow `'imessage'`, and
   [`20260614120000_imessage_operator_console.sql`](../../supabase/migrations/20260614120000_imessage_operator_console.sql)
   adds the allowlist + archive tables and their service-role RPCs. Apply both.
2. **Env vars** (set in `.env.local` and the Vercel project — the Vercel connector
   has no env-var tool, so set them by hand):
   - `IMESSAGE_INGEST_SECRET` — a long random string.
   - `IMESSAGE_OPERATOR_USER_ID` — the operator's `profiles.id`.
3. **Curate the allowlist** in the dashboard: Sources → iMessage (operator-only).
4. **Run the reader on the Mac** (Full Disk Access required):
   ```sh
   IMESSAGE_INGEST_SECRET=… JARVIS_APP_URL=https://mydearestjarvis.vercel.app \
     node scripts/imessage/read-chat-db.mjs --since-days 7
   ```
   A cursor at `~/.jarvis/imessage-cursor.json` makes re-runs incremental. Use
   `--backfill --since-days 365` once to archive history for newly-allowlisted
   contacts. Use `--dry-run` to preview without sending. Scheduled unattended via the
   launchd agent `com.jarvis.imessage-reader` (3×/day).

## Code map

- Ingest route: [`app/api/integrations/imessage/ingest/route.ts`](../../app/api/integrations/imessage/ingest/route.ts)
- Allowlist CRUD (operator session): [`app/api/integrations/imessage/allowlist/route.ts`](../../app/api/integrations/imessage/allowlist/route.ts)
- Reader allowlist fetch (bearer): [`app/api/integrations/imessage/filter-config/route.ts`](../../app/api/integrations/imessage/filter-config/route.ts)
- Bearer gate: [`lib/imessage/operator-auth.ts`](../../lib/imessage/operator-auth.ts)
- Session gate + `isImessageOperator`: [`lib/imessage/operator-session.ts`](../../lib/imessage/operator-session.ts)
- Handle normalize / shortcode: [`lib/imessage/handles.ts`](../../lib/imessage/handles.ts)
- Allowlist + archive data access: [`lib/imessage/store.ts`](../../lib/imessage/store.ts)
- Ingest + archive + extraction wiring: [`lib/imessage/ingest.ts`](../../lib/imessage/ingest.ts)
- Console pane (UI): [`components/dashboard/sources/imessage-console.tsx`](../../components/dashboard/sources/imessage-console.tsx)
- Assistant retrieval: `read_messages` in [`lib/assistant/orchestrator.ts`](../../lib/assistant/orchestrator.ts) + `loadImessageThread` in [`lib/assistant/secretary.ts`](../../lib/assistant/secretary.ts)
- Local reader: [`scripts/imessage/read-chat-db.mjs`](../../scripts/imessage/read-chat-db.mjs)
- Provenance type: `SourceKind` in [`types/index.ts`](../../types/index.ts) (`imessage` is a snapshot label; the connector pane is gated client-side by `isImessageOperator`, not a public connector).
