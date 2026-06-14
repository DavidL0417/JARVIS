-- Operator-only iMessage intake (hidden backend, single user).
--
-- DELIBERATELY NOT A CONNECTOR. iMessage is NOT added to connector_settings and
-- has no UI, no token table, and no per-user onboarding. It is a private,
-- operator-only intake: macOS keeps all iMessage/SMS history in
-- ~/Library/Messages/chat.db, and a local reader on the operator's Mac
-- (scripts/imessage/read-chat-db.mjs) decodes it and POSTs recent messages to
-- /api/integrations/imessage/ingest. That route is gated by two env vars only the
-- operator sets — IMESSAGE_INGEST_SECRET + IMESSAGE_OPERATOR_USER_ID — and 404s
-- for everyone else. See docs/decisions/operator-only-imessage.md.
--
-- This migration only widens the source-provenance CHECK constraints so snapshots
-- (and any future source files) can be labeled 'imessage'. No new tables, RPCs,
-- connector rows, or RLS policies — nothing that would surface in the product.

alter table public.source_snapshots drop constraint if exists source_snapshots_source_check;
alter table public.source_snapshots add constraint source_snapshots_source_check
  check (source in ('notion', 'gmail', 'caldav', 'google_calendar', 'manual', 'system', 'canvas', 'apple_reminders', 'imessage'));

alter table public.source_files drop constraint if exists source_files_source_check;
alter table public.source_files add constraint source_files_source_check
  check (source in ('notion', 'gmail', 'caldav', 'google_calendar', 'manual', 'system', 'canvas', 'apple_reminders', 'imessage'));
