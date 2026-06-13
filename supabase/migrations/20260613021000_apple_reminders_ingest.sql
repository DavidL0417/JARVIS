-- Apple Reminders ingest via a device-side Apple Shortcut.
--
-- Apple froze CalDAV access to upgraded iCloud Reminders, so we can't read them
-- server-side. Instead an Apple Shortcut (EventKit-backed) POSTs the user's live
-- snapshot of incomplete reminders to a token-authed webhook, which mirrors them
-- into tasks (last_synced_from='apple_reminders') and reconciles removals.

-- 1. Allow 'apple_reminders' everywhere it can appear.
alter table public.tasks drop constraint if exists tasks_last_synced_from_check;
alter table public.tasks add constraint tasks_last_synced_from_check
  check (last_synced_from in ('local', 'caldav', 'apple_reminders'));

alter table public.source_snapshots drop constraint if exists source_snapshots_source_check;
alter table public.source_snapshots add constraint source_snapshots_source_check
  check (source in ('notion', 'gmail', 'caldav', 'google_calendar', 'manual', 'system', 'canvas', 'apple_reminders'));

alter table public.source_files drop constraint if exists source_files_source_check;
alter table public.source_files add constraint source_files_source_check
  check (source in ('notion', 'gmail', 'caldav', 'google_calendar', 'manual', 'system', 'canvas', 'apple_reminders'));

alter table public.connector_settings drop constraint if exists connector_settings_connector_id_check;
alter table public.connector_settings add constraint connector_settings_connector_id_check
  check (connector_id in ('google_calendar', 'gmail', 'notion', 'canvas', 'caldav', 'apple_reminders'));

-- 2. Token store for the Shortcut client (mirrors app_private.canvas_extension_tokens).
create table if not exists app_private.apple_reminders_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  label text not null default 'Apple Reminders Shortcut',
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists apple_reminders_tokens_user_active_idx
  on app_private.apple_reminders_tokens(user_id) where revoked_at is null;

revoke all on app_private.apple_reminders_tokens from anon, authenticated;
-- The RPCs below are security invoker (run as service_role), so service_role needs
-- table privileges — mirrors the grants on app_private.canvas_extension_tokens.
grant select, insert, update on app_private.apple_reminders_tokens to service_role;

-- 3. Public RPCs bridge app_private (not exposed to PostgREST), service_role only.
--    Mints one active token per user: regenerating revokes any prior token.
create or replace function public.mint_apple_reminders_token(
  token_user_id uuid,
  token_hash text,
  token_label text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update app_private.apple_reminders_tokens
    set revoked_at = now(), updated_at = now()
    where user_id = token_user_id and revoked_at is null;

  insert into app_private.apple_reminders_tokens (user_id, token_hash, label)
    values (token_user_id, token_hash, coalesce(nullif(token_label, ''), 'Apple Reminders Shortcut'));
end;
$$;

create or replace function public.get_apple_reminders_token(lookup_token_hash text)
returns table (id uuid, user_id uuid, revoked_at timestamptz)
language sql
security invoker
set search_path = ''
as $$
  select t.id, t.user_id, t.revoked_at
  from app_private.apple_reminders_tokens t
  where t.token_hash = lookup_token_hash
  limit 1;
$$;

create or replace function public.mark_apple_reminders_token_used(token_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update app_private.apple_reminders_tokens
    set last_used_at = now(), updated_at = now()
    where id = token_id;
$$;

revoke all on function public.mint_apple_reminders_token(uuid, text, text) from public, anon, authenticated;
revoke all on function public.get_apple_reminders_token(text) from public, anon, authenticated;
revoke all on function public.mark_apple_reminders_token_used(uuid) from public, anon, authenticated;

grant execute on function public.mint_apple_reminders_token(uuid, text, text) to service_role;
grant execute on function public.get_apple_reminders_token(text) to service_role;
grant execute on function public.mark_apple_reminders_token_used(uuid) to service_role;
