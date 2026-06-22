# Operator-only Raycast Notes intake — a deliberately hidden backend

**For future agents: this feature is intentional, single-user, and operator-only.
Do not "finish" it into a public connector, do not add a self-serve onboarding /
token flow, and do not surface it to anyone but the operator.** It exists so the
operator (David) can feed his own Raycast Notes scratchpad into JARVIS as ambient
context. No other user is meant to discover or use it. It mirrors the
[operator-only iMessage intake](./operator-only-imessage.md).

There **is** one operator-only UI surface: a **read-only status card** under the
`Operator` group of the Sources panel, rendered *only* when the signed-in user is the
operator (`isRaycastOperator`, i.e. their id === `RAYCAST_OPERATOR_USER_ID`). It has no
connect button, no toggle, and no token flow — it just shows that the intake is alive
(last-fed time + digest counts) so the operator can confirm it without reading the DB.
Every non-operator sees nothing, exactly as before. This is a deliberate, scoped
exception to "no UI" — adding the *status* card was the point of that change; do not
mistake it for a self-serve connector and do not remove the operator gate.

## What it does

Raycast keeps every Note in a **SQLCipher-encrypted** SQLite database at
`~/Library/Application Support/com.raycast.macos/raycast-enc.sqlite`; the
decryption key lives in the macOS Keychain (service `Raycast`, account
`database_key`), and the passphrase is `sha256(database_key + salt)`. A local
reader on the operator's Mac — [`scripts/raycast/push-notes.py`](../../scripts/raycast/push-notes.py) —
decrypts that DB, renders each note's ProseMirror document JSON to markdown,
extracts the checkbox tasks and freeform bullets, and POSTs a full snapshot to
`POST /api/integrations/raycast/ingest`. Snapshots are labeled with source
provenance `raycast`.

**Unlike Gmail / iMessage, this runs NO extraction and creates NO tasks or
candidates.** The notes are mirrored one-way as pure *source context*: the ingest
writes a single `source_snapshots` row whose **summary** is a deterministic digest
(counts + the most relevant open scratchpad tasks) and whose **payload** holds the
full notes + items. The assistant surfaces the digest under "Source Status"
([`lib/assistant/context.ts`](../../lib/assistant/context.ts) reads `summary`, not
`payload`), so the secretary can reference David's own to-dos and thoughts without
those scratchpad lines becoming first-class tasks behind his back.

The product value: Raycast Notes are David's fastest scratchpad. Surfacing them as
context (not as commitments) lets the assistant notice "you wrote down X" without
the noise of auto-importing half-formed bullets.

## Why it's built this way (and not as a connector)

The decryption + parsing is lifted from the proven Claude - Scheduler exporter
(`scripts/raycast_notes_export.py`); the *intake* shape copies the iMessage
operator pattern, which is deliberately more hidden than the Apple Reminders
connector:

| | Apple Reminders | iMessage | Raycast (this) |
|---|---|---|---|
| Self-serve connector card | yes | **no** | **no** |
| Operator-only card (gated render) | n/a | **yes (console)** | **yes (read-only status)** |
| `connector_settings` row | yes | **no** | **no** |
| Token table + mint flow | yes | **no** | **no** |
| In `SourceConnectorId` (auth-bearing) | yes | **no** | **no** |
| Auth | per-user bearer token | shared env secret, pinned to one user id | **shared env secret, pinned to one user id** |
| Server-side extraction → tasks | yes (mirror) | yes (candidates) | **no — snapshot context only** |

The operator card uses a UI-only panel id (`SourcePanelId` in
[`shared.tsx`](../../components/dashboard/sources/shared.tsx)), **not** a
`SourceConnectorId` — so it renders a card without becoming an auth-bearing connector.
`raycast` is still a snapshot label + a panel id only; it has no `connector_settings`,
no token table, and no extraction.

Rationale:

- **No connector / no UI / no token table** = nothing for another user to find,
  enable, or even see. The smaller the surface, the more truly hidden it is.
- **Env-gated + operator-pinned.** The route reads two env vars:
  - `RAYCAST_INGEST_SECRET` — the bearer secret the local reader sends.
  - `RAYCAST_OPERATOR_USER_ID` — the single profile id every snapshot is written
    to. Even if the endpoint and secret leaked, ingest only ever writes to the
    operator's account.
  This mirrors the iMessage precedent (`IMESSAGE_INGEST_SECRET` +
  `IMESSAGE_OPERATOR_USER_ID`) — a dedicated secret separate from `CRON_SECRET`,
  because this one *writes*.
- **404 on every failure.** When either env var is unset, or the token is
  missing/wrong, the route returns a 404 indistinguishable from a non-existent
  route ([`requireRaycastOperator`](../../lib/raycast/operator-auth.ts)). In any
  deployment that hasn't opted in, the feature simply does not exist.

## Why a local reader (and not server-side)

- Raycast's DB is **SQLCipher-encrypted with a key only in the operator's
  Keychain**. The server can never read it; decryption is physically Mac-local.
- The reader is **read-only**: it copies the DB (+ WAL/SHM sidecars) to a temp dir
  before reading, never touches the live file, and never writes back to Raycast.
- Re-running is cheap: the server **idle-skips** byte-identical snapshots (content
  hash over note id + modified time + body), so a no-change run writes nothing and
  doesn't crowd the recent-sources window.

## Privacy stance

This is the operator's own scratchpad on the operator's own machine for the
operator's own use. It must **not** be generalized to other users.

## Operating it

1. **DB migration** — [`supabase/migrations/20260614130000_raycast_operator_ingest.sql`](../../supabase/migrations/20260614130000_raycast_operator_ingest.sql)
   widens the `source_snapshots` / `source_files` source CHECK constraints to allow
   `'raycast'`. Apply it before the route can record snapshots.
2. **Env vars** (set in `.env.local` and the Vercel project — the Vercel connector
   has no env-var tool, so set them by hand):
   - `RAYCAST_INGEST_SECRET` — a long random string.
   - `RAYCAST_OPERATOR_USER_ID` — the operator's `profiles.id`.
3. **Install `sqlcipher`** on the Mac: `brew install sqlcipher`.
4. **Run the reader on the Mac:**
   ```sh
   RAYCAST_INGEST_SECRET=… JARVIS_APP_URL=https://secretaryjarvis.com \
     python3 scripts/raycast/push-notes.py
   ```
   Use `--dry-run` to preview the parsed payload without sending. Schedule it
   (cron / launchd / a Claude scheduled task) for ongoing intake.

## Code map

- Route: [`app/api/integrations/raycast/ingest/route.ts`](../../app/api/integrations/raycast/ingest/route.ts)
- Auth gate: [`lib/raycast/operator-auth.ts`](../../lib/raycast/operator-auth.ts)
- Ingest (snapshot only, no extraction): [`lib/raycast/ingest.ts`](../../lib/raycast/ingest.ts)
- Request schema: [`schemas/raycast.ts`](../../schemas/raycast.ts)
- Local reader: [`scripts/raycast/push-notes.py`](../../scripts/raycast/push-notes.py)
- Provenance type: `SourceKind` in [`types/index.ts`](../../types/index.ts) (`raycast` is a snapshot label; deliberately NOT in `SourceConnectorId`, so it never becomes an auth-bearing connector).
- Operator session gate (UI): [`lib/raycast/operator-session.ts`](../../lib/raycast/operator-session.ts) — `isRaycastOperator` (dashboard payload flag) + `requireRaycastOperatorSession` (404 gate for the status route).
- Status route (read-only): [`app/api/integrations/raycast/status/route.ts`](../../app/api/integrations/raycast/status/route.ts) — latest snapshot's captured-at + digest counts; 404 for non-operators.
- Status card (read-only): [`components/dashboard/sources/raycast-console.tsx`](../../components/dashboard/sources/raycast-console.tsx) — rendered under the `Operator` group only when `isRaycastOperator`.
