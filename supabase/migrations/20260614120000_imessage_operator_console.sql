-- Operator-only iMessage console: curated contact allowlist + full-message archive.
--
-- Extends the hidden operator-only intake (see 20260613153000_imessage_operator_ingest.sql
-- and docs/decisions/operator-only-imessage.md) with two private stores, BOTH still
-- single-operator and invisible to everyone else:
--
--   1. imessage_contact_allowlist — the curated contacts the operator manages from a
--      hidden, operator-gated dashboard pane. The local reader fetches this list to
--      decide whose messages are worth sending (allowlist + 2-way 1:1s; shortcodes
--      and non-allowlisted groups are dropped ON THE MAC before anything is POSTed).
--
--   2. imessage_messages — a durable, full-content archive of every message that
--      passes the filter, so the assistant can answer "what did X say" instead of
--      only seeing extracted highlights. Previously the raw text was discarded after
--      extraction; this keeps it.
--
-- Both live in app_private (NOT exposed to PostgREST) and are reachable only through
-- service_role RPCs. There are no RLS policies and no authenticated/anon grants:
-- operator-gating is enforced at the route layer (session user id === the operator
-- env id) and, for the reader, by the shared IMESSAGE_INGEST_SECRET. Defense in depth.

-- 1. Curated contact allowlist (operator-managed via the hidden UI) ------------------
create table if not exists app_private.imessage_contact_allowlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  display_name text not null,
  handle text not null,
  -- Canonical match key: phones -> last 10 digits, emails -> lowercased. Lets
  -- '+1 (555) 202-4226', '5552024226', and '15552024226' collapse to one contact.
  handle_norm text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, handle_norm)
);

create index if not exists imessage_contact_allowlist_user_idx
  on app_private.imessage_contact_allowlist(user_id);

revoke all on app_private.imessage_contact_allowlist from anon, authenticated;
grant select, insert, update, delete on app_private.imessage_contact_allowlist to service_role;

-- 2. Full-message archive (durable copy of every FILTERED message) -------------------
create table if not exists app_private.imessage_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  guid text not null,
  handle text,
  handle_norm text,
  sender_name text,
  body text not null,
  sent_at timestamptz,
  is_from_me boolean not null default false,
  service text,
  chat_name text,
  is_group boolean not null default false,
  created_at timestamptz not null default now(),
  -- Idempotent: the reader re-sends overlapping windows on backfill / retries.
  unique (user_id, guid)
);

-- Retrieval is "newest messages for this person" -> (user, handle_norm, sent_at desc).
create index if not exists imessage_messages_user_handle_idx
  on app_private.imessage_messages(user_id, handle_norm, sent_at desc);
create index if not exists imessage_messages_user_sent_idx
  on app_private.imessage_messages(user_id, sent_at desc);

revoke all on app_private.imessage_messages from anon, authenticated;
grant select, insert on app_private.imessage_messages to service_role;

-- 3. RPCs bridge app_private (unexposed) -> service_role only ------------------------
--    security invoker: run with the caller's (service_role) privileges; search_path
--    pinned empty so every reference must be schema-qualified.

create or replace function public.get_imessage_allowlist(list_user_id uuid)
returns table (id uuid, display_name text, handle text, handle_norm text)
language sql
security invoker
set search_path = ''
as $$
  select a.id, a.display_name, a.handle, a.handle_norm
  from app_private.imessage_contact_allowlist a
  where a.user_id = list_user_id
  order by a.display_name;
$$;

-- Upsert on the normalized handle so re-adding a known contact just refreshes the name.
create or replace function public.add_imessage_contact(
  contact_user_id uuid,
  contact_display_name text,
  contact_handle text,
  contact_handle_norm text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id uuid;
begin
  insert into app_private.imessage_contact_allowlist (user_id, display_name, handle, handle_norm)
    values (contact_user_id, contact_display_name, contact_handle, contact_handle_norm)
  on conflict (user_id, handle_norm) do update
    set display_name = excluded.display_name,
        handle = excluded.handle,
        updated_at = now()
  returning id into new_id;
  return new_id;
end;
$$;

create or replace function public.remove_imessage_contact(contact_user_id uuid, contact_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from app_private.imessage_contact_allowlist
  where user_id = contact_user_id and id = contact_id;
$$;

-- Batch-archive a POSTed window; idempotent on (user_id, guid). Returns the count of
-- rows that were actually NEW, so ingest can report how much fresh history it captured.
create or replace function public.upsert_imessage_messages(message_user_id uuid, message_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  with incoming as (
    select
      r->>'guid' as guid,
      r->>'handle' as handle,
      r->>'handle_norm' as handle_norm,
      r->>'sender_name' as sender_name,
      r->>'body' as body,
      nullif(r->>'sent_at', '')::timestamptz as sent_at,
      coalesce((r->>'is_from_me')::boolean, false) as is_from_me,
      r->>'service' as service,
      r->>'chat_name' as chat_name,
      coalesce((r->>'is_group')::boolean, false) as is_group
    from jsonb_array_elements(message_rows) as r
  ),
  ins as (
    insert into app_private.imessage_messages
      (user_id, guid, handle, handle_norm, sender_name, body, sent_at, is_from_me, service, chat_name, is_group)
    select
      message_user_id, guid, handle, handle_norm, sender_name, body, sent_at, is_from_me, service, chat_name, is_group
    from incoming
    where guid is not null and body is not null and length(body) > 0
    on conflict (user_id, guid) do nothing
    returning 1
  )
  select count(*) into inserted_count from ins;
  return inserted_count;
end;
$$;

-- Retrieve the newest messages for a set of normalized handles (one contact's
-- threads). Pass null handles to scan everything (bounded by max_rows).
create or replace function public.get_imessage_messages(
  query_user_id uuid,
  query_handles text[],
  max_rows integer
)
returns table (
  handle text,
  handle_norm text,
  sender_name text,
  body text,
  sent_at timestamptz,
  is_from_me boolean,
  chat_name text,
  is_group boolean
)
language sql
security invoker
set search_path = ''
as $$
  select m.handle, m.handle_norm, m.sender_name, m.body, m.sent_at, m.is_from_me, m.chat_name, m.is_group
  from app_private.imessage_messages m
  where m.user_id = query_user_id
    and (query_handles is null or m.handle_norm = any(query_handles))
  order by m.sent_at desc nulls last
  limit greatest(coalesce(max_rows, 200), 1);
$$;

revoke all on function public.get_imessage_allowlist(uuid) from public, anon, authenticated;
revoke all on function public.add_imessage_contact(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.remove_imessage_contact(uuid, uuid) from public, anon, authenticated;
revoke all on function public.upsert_imessage_messages(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.get_imessage_messages(uuid, text[], integer) from public, anon, authenticated;

grant execute on function public.get_imessage_allowlist(uuid) to service_role;
grant execute on function public.add_imessage_contact(uuid, text, text, text) to service_role;
grant execute on function public.remove_imessage_contact(uuid, uuid) to service_role;
grant execute on function public.upsert_imessage_messages(uuid, jsonb) to service_role;
grant execute on function public.get_imessage_messages(uuid, text[], integer) to service_role;
