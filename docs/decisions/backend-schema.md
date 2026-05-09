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
- Public integration rows may expose connection metadata only: provider, account email, status, selected calendar, and sync timestamps.

## Production V1 Tables

- Public: `profiles`, `preferences`, `calendars`, `tasks`, `schedule_events`, `checkins`, `integrations`, `assistant_threads`, `assistant_messages`, `assistant_tool_runs`, `memory_items`, `source_snapshots`, `source_files`, `source_candidates`, `daily_plans`, `change_logs`.
- Private: `app_private.integration_tokens`.

## Calendar Source Of Truth

- `schedule_events` is the canonical app event store.
- Imported Google events are mirrored into `schedule_events`.
- JARVIS-created task/focus blocks are persisted first, then synced outward when Google is connected.
- Google OAuth provider tokens are captured from the callback exchange result immediately; sync responses expose an explicit authorization-required state instead of a generic failure.
- Source connector readiness is derived on the server from public integration rows, private token presence, known OAuth scopes, and required environment variables. The UI must not treat a public `connected` row as runnable unless the private token/scope check also passes.

## Source Intake And Plans

- Original uploaded context lives in the private Supabase Storage bucket `source-originals`; table rows in `source_files` point to those objects and carry processing status.
- Extracted source facts enter `source_candidates` first. The app may approve candidates into tasks or memory, but it should not silently mutate the scheduler from inferred source text.
- Gmail scans are context refreshes first and task extraction second. Source snapshots should preserve a planning digest even when no candidate needs approval.
- Gmail authorization and Gmail API availability are separate readiness checks. If the Cloud project has not enabled `gmail.googleapis.com`, record a failed Gmail source snapshot and do not treat it as a user reauthorization problem.
- Notion source intake uses a public OAuth connection, stores tokens in `app_private.integration_tokens`, and requires a user-selected authoritative tasks database on the integration row before importing. Imports query that database directly instead of broad workspace search.
- `daily_plans` records the current command-deck plan: horizon, summary, now item, next items, risk items, source coverage, tradeoffs, model, and command.
- Planner-created task blocks may reference `daily_plans.id` through `tasks.plan_id` and `schedule_events.plan_id`.
