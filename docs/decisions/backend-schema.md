# Backend Schema And Migration Policy

## Source Of Truth

- Supabase migrations in `supabase/migrations` are authoritative.
- Do not apply manual SQL that is not represented by a migration.
- `sql/schema.sql`, if regenerated, is a snapshot/reference artifact only.

## Security

- Every public table must have RLS enabled.
- User-owned public rows must be scoped to `auth.uid()`.
- Browser clients should go through backend routes for app data. Direct table grants to `anon` and `authenticated` are revoked by migration unless a future feature explicitly reopens a table with RLS-backed policies.
- OAuth tokens and provider secrets belong in `app_private`, not public tables.
- Backend token reads and writes go through service-role-only RPC wrappers so `app_private` does not need to be exposed as a Supabase API schema.
- Public integration rows may expose connection metadata only: provider, account email, status, selected calendar/source metadata, and sync timestamps.
- Canvas personal access tokens are a pilot-only integration secret. Store them only in `app_private.integration_tokens`; public integration rows may store the Canvas base URL/host and account metadata for readiness display.
- Canvas extension pairing codes and extension bearer tokens are private credentials. Store only hashes in `app_private.canvas_extension_pairing_codes` and `app_private.canvas_extension_tokens`; never expose them through public tables.
- Canvas extension control-plane rows are public metadata with RLS, not credentials. `canvas_extension_sessions`, `canvas_extension_commands`, `canvas_extension_command_events`, and `canvas_extension_nodes` may store connection status, command state, progress events, URLs, titles, selection state, compact evidence, and sanitized inert Canvas page previews only. Captured previews should prefer block metadata (`text`, `links`, or `mixed`) so the reader can surface syllabus prose separately from link-heavy course-summary/module lists.
- CalDAV app passwords are integration secrets. Store them only in `app_private.integration_tokens`; public integration rows may store the CalDAV server URL/host, username/account label, status, and sync timestamps.

## Production V1 Tables

- Public: `profiles`, `preferences`, `calendars`, `tasks`, `schedule_events`, `checkins`, `integrations`, `assistant_threads`, `assistant_messages`, `assistant_tool_runs`, `memory_items`, `source_snapshots`, `source_files`, `source_candidates`, `daily_plans`, `change_logs`.
- Private: `app_private.integration_tokens`.
- `memory_items` carries ordered assistant context with `layer` plus structured `payload`; context loaders must respect the layer contract instead of treating memory as a flat list.
- `assistant_tool_runs.payload` stores executable approval plans. Tool runs can move through `pending_approval`, `completed`, `error`, or `cancelled`, with approval/execution/cancellation timestamps and preserved error messages.

## Calendar Source Of Truth

- `schedule_events` is the canonical app event store.
- Imported Google events are mirrored into `schedule_events`. A successful Google Calendar refresh reconciles that mirror against the provider window and removes imported Google rows that disappeared from Google, so deleted classes or unsubscribed calendars do not remain as fixed commitments.
- Imported CalDAV events are mirrored into `schedule_events` as read-only calendar events with `last_synced_from = 'caldav'` and stable `external_event_id` values.
- Connector enablement lives in `connector_settings`. A connected but disabled source keeps credentials and mirrored rows, but source refresh and planning must skip it intentionally instead of treating it as a failure.
- JARVIS-created task/focus blocks are persisted first. Syncing task blocks outward to Google Calendar is an approval-backed assistant tool run, not part of normal calendar reads.
- Google app sign-in and Google source authorization are separate OAuth intents. Plain sign-in uses the provider for identity only; Calendar/Gmail authorization requests the offline source scopes and captures provider tokens from the callback exchange result immediately.
- Sync responses expose an explicit authorization-required state instead of a generic failure.
- Source connector readiness is derived on the server from public integration rows, private token presence, known OAuth scopes, and required environment variables. The UI must not treat a public `connected` row as runnable unless the private token/scope check also passes.
- CalDAV may appear as a public integration provider for connected calendar-source metadata. It must be accepted by response contracts even while richer CalDAV source refresh remains modeled separately.
- Remote calendar rows from Google and CalDAV are sync-managed for identity/name, but users may change local display fields such as visibility, color, and sync preference.
- Daily Vercel Cron calls `/api/cron/source-refresh` with `CRON_SECRET`. The daily cadence keeps Hobby deployments valid; manual refreshes and forced pre-plan refreshes cover fresh planning needs. Cron isolates per-user failures and records failed source snapshots instead of hiding refresh problems.

## Source Intake And Plans

- Original uploaded context lives in the private Supabase Storage bucket `source-originals`; table rows in `source_files` point to those objects and carry processing status.
- Extracted source facts enter `source_candidates` first. The app may approve candidates into tasks or memory, but it should not silently mutate the scheduler from inferred source text.
- Gmail scans are context refreshes first and task extraction second. Source snapshots should preserve a planning digest even when no candidate needs approval.
- Gmail authorization and Gmail API availability are separate readiness checks. If the Cloud project has not enabled `gmail.googleapis.com`, record a failed Gmail source snapshot and do not treat it as a user reauthorization problem.
- Notion source intake uses a public OAuth connection, stores tokens in `app_private.integration_tokens`, and requires a user-selected authoritative tasks database on the integration row before importing. Imports query that database directly instead of broad workspace search.
- Canvas source intake uses a user-generated access token for the one-client pilot. It imports bounded planner items into auto-approved source candidates and linked tasks using Canvas plannable IDs for dedupe. Completing a Canvas-backed task may only write a planner override with `marked_complete`; it must not submit coursework, alter grades, upload files, or post comments.
- Canvas Academic Reader is an internal Chrome-extension fallback for schools that disable personal access tokens. The extension is a minimal browser bridge: it heartbeats, polls backend commands, navigates read-only Canvas pages, reports command events, and submits selected snapshots or file metadata. JARVIS owns command selection, nested node expansion, preview-link capture, stop/resume, and imports. Root discovery starts from Canvas `/courses` and records actual All Courses enrollment rows before any per-course expansion; course expansion stores Canvas course-navigation tabs as children of the selected course, then tab expansion stores page/file/module/assignment items under that tab and stores a sanitized, non-executable page preview on the expanded node. The preview is segmented into reader modules by heading/table/list structure and link density; prose-heavy syllabus sections should render as text blocks, while tables such as Course Summary should render as link blocks. Preview links are rewritten into same-origin capture commands instead of storing raw MHTML or running Canvas scripts inside JARVIS. Nested scrapes must ignore links back to `/courses/:id` so assignment breadcrumbs cannot reparent or overwrite root course rows.
- Canvas extension state derives a health object from auth, session heartbeat, active command, and the latest command event. Supabase auth/network timeouts must be surfaced as backend timeout/error states, not collapsed into signed-out `Authentication required` states.
- `daily_plans` records the current command-deck plan: horizon, summary, now item, next items, risk items, source coverage, tradeoffs, model, and command.
- Planner-created task blocks may reference `daily_plans.id` through `tasks.plan_id` and `schedule_events.plan_id`.
- Daily planning performs a forced pre-plan refresh for every connected/runnable source. Missing or never-configured sources are coverage gaps; connected/runnable source failures are hard planning failures.
- Master Input and the daily command deck share the same daily-plan service, so natural-language commands are passed into the scheduling prompt and persisted on `daily_plans.command`.
