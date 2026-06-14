# Operator-only iMessage intake — a deliberately hidden backend

**For future agents: this feature is intentional, single-user, and invisible by
design. Do not "finish" it into a public connector, do not add UI for it, and do
not be confused that it has no onboarding flow.** It exists so the operator
(David) can feed his own iMessage/SMS history into JARVIS's scheduler-candidate
pipeline. No other user is meant to discover or use it.

## What it does

macOS keeps every iMessage and SMS (when Text Message Forwarding is on) in a
local SQLite database at `~/Library/Messages/chat.db`. A local reader on the
operator's Mac — [`scripts/imessage/read-chat-db.mjs`](../../scripts/imessage/read-chat-db.mjs) —
snapshots that DB, decodes recent messages, and POSTs them to
`POST /api/integrations/imessage/ingest`. The route runs them through the **same
extraction → candidate → auto-approve pipeline as Gmail**
([`extractCandidatesFromText`](../../lib/sources/extraction.ts)), so texts become
scheduler candidates behind the normal approval gate. Snapshots are labeled with
source provenance `imessage`.

The product value: texts are the richest untapped source of *soft commitments*
("can you send me the deck by Friday") that a secretary should catch.

## Why it's built this way (and not as a connector)

The Apple Reminders integration is the closest sibling, but iMessage is
deliberately **more hidden** than it:

| | Apple Reminders | iMessage (this) |
|---|---|---|
| Connector card in UI | yes | **no** |
| `connector_settings` row | yes | **no** |
| Token table + mint flow | yes (`app_private.apple_reminders_tokens`) | **no** |
| Auth | per-user bearer token | **shared env secret, pinned to one user id** |
| Who can enable | any signed-in user | **only whoever sets the env vars** |

Rationale:

- **No connector / no UI / no token table** = nothing for another user to find,
  enable, or even see. The smaller the surface, the more truly hidden it is.
- **Env-gated + operator-pinned.** The route reads two env vars:
  - `IMESSAGE_INGEST_SECRET` — the bearer secret the local reader sends.
  - `IMESSAGE_OPERATOR_USER_ID` — the single profile id every ingested message is
    written to. Even if the endpoint and secret leaked, ingest only ever writes to
    the operator's account.
  This mirrors the existing operator-only precedent (`AUTOMATION_OWNER_USER_ID` +
  `AUTOMATION_STATUS_TOKEN` in [automation-pause.md](./automation-pause.md)) — a
  dedicated secret separate from `CRON_SECRET`, because this one *writes*.
- **404 on every failure.** When either env var is unset, or the token is
  missing/wrong, the route returns a 404 indistinguishable from a non-existent
  route ([`requireImessageOperator`](../../lib/imessage/operator-auth.ts)). In any
  deployment that hasn't opted in, the feature simply does not exist.

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

The other party in every conversation never consented to being scraped. This is
acceptable **only** because it is the operator's own data on the operator's own
machine for the operator's own use. It must **not** be generalized to other users.
If it ever were, the model would have to change to local-only extraction that
ships structured signals (a task, a date) and never raw message bodies.

## Operating it

1. **DB migration** — [`supabase/migrations/20260613153000_imessage_operator_ingest.sql`](../../supabase/migrations/20260613153000_imessage_operator_ingest.sql)
   widens the `source_snapshots` / `source_files` source CHECK constraints to allow
   `'imessage'`. Apply it before the route can record snapshots.
2. **Env vars** (set in `.env.local` and the Vercel project — the Vercel connector
   has no env-var tool, so set them by hand):
   - `IMESSAGE_INGEST_SECRET` — a long random string.
   - `IMESSAGE_OPERATOR_USER_ID` — the operator's `profiles.id`.
3. **Run the reader on the Mac** (Full Disk Access required):
   ```sh
   IMESSAGE_INGEST_SECRET=… JARVIS_APP_URL=https://mydearestjarvis.vercel.app \
     node scripts/imessage/read-chat-db.mjs --since-days 7
   ```
   A cursor at `~/.jarvis/imessage-cursor.json` makes re-runs incremental. Schedule
   it (cron / launchd / a Claude scheduled task) for ongoing intake. Use
   `--dry-run` to preview without sending.

## Code map

- Route: [`app/api/integrations/imessage/ingest/route.ts`](../../app/api/integrations/imessage/ingest/route.ts)
- Auth gate: [`lib/imessage/operator-auth.ts`](../../lib/imessage/operator-auth.ts)
- Ingest + extraction wiring: [`lib/imessage/ingest.ts`](../../lib/imessage/ingest.ts)
- Request schema: [`schemas/imessage.ts`](../../schemas/imessage.ts)
- Local reader: [`scripts/imessage/read-chat-db.mjs`](../../scripts/imessage/read-chat-db.mjs)
- Provenance type: `SourceKind` in [`types/index.ts`](../../types/index.ts) (`imessage` is a snapshot label only — deliberately NOT in `SourceConnectorId`, so no connector card renders).
