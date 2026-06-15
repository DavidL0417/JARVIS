-- Operator-only Raycast Notes intake (hidden backend, single user).
--
-- DELIBERATELY NOT A CONNECTOR — mirrors the operator-only iMessage intake. Raycast
-- is NOT added to connector_settings and has no UI, no token table, and no per-user
-- onboarding. Raycast stores Notes in a SQLCipher-encrypted SQLite database at
-- ~/Library/Application Support/com.raycast.macos/raycast-enc.sqlite (decryption key
-- in the macOS Keychain). A local reader on the operator's Mac
-- (scripts/raycast/push-notes.py) decrypts it, parses notes into markdown + items,
-- and POSTs a snapshot to /api/integrations/raycast/ingest. That route is gated by
-- two env vars only the operator sets — RAYCAST_INGEST_SECRET + RAYCAST_OPERATOR_USER_ID
-- — and 404s for everyone else. See docs/decisions/operator-only-raycast.md.
--
-- This migration only widens the source-provenance CHECK constraints so snapshots
-- (and any future source files) can be labeled 'raycast'. No new tables, RPCs,
-- connector rows, or RLS policies — nothing that would surface in the product.

alter table public.source_snapshots drop constraint if exists source_snapshots_source_check;
alter table public.source_snapshots add constraint source_snapshots_source_check
  check (source in ('notion', 'gmail', 'caldav', 'google_calendar', 'manual', 'system', 'canvas', 'apple_reminders', 'imessage', 'raycast'));

alter table public.source_files drop constraint if exists source_files_source_check;
alter table public.source_files add constraint source_files_source_check
  check (source in ('notion', 'gmail', 'caldav', 'google_calendar', 'manual', 'system', 'canvas', 'apple_reminders', 'imessage', 'raycast'));
