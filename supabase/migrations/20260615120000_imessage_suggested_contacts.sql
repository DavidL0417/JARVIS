-- Operator-only: suggested iMessage contacts (recent 1:1 people not yet allowlisted).
--
-- The local reader is the only thing that can see chat.db + macOS Contacts, so it
-- computes the most-recent 1:1 conversations the operator hasn't allowlisted yet
-- (resolving names from AddressBook where it can) and replace-uploads them here. The
-- operator console surfaces them as one-click "Add" rows. app_private, service_role
-- only, like the rest of the iMessage console (see operator-only-imessage.md).

create table if not exists app_private.imessage_suggested_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  handle text not null,
  handle_norm text not null,
  display_name text,
  last_seen timestamptz,
  message_count integer not null default 0,
  sent_count integer not null default 0,
  recv_count integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, handle_norm)
);

create index if not exists imessage_suggested_contacts_user_idx
  on app_private.imessage_suggested_contacts(user_id, last_seen desc);

revoke all on app_private.imessage_suggested_contacts from anon, authenticated;
grant select, insert, delete on app_private.imessage_suggested_contacts to service_role;

-- Replace-all upload from the reader: the suggestion set is recomputed each run.
create or replace function public.replace_imessage_suggestions(suggestion_user_id uuid, suggestion_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  delete from app_private.imessage_suggested_contacts where user_id = suggestion_user_id;
  with ins as (
    insert into app_private.imessage_suggested_contacts
      (user_id, handle, handle_norm, display_name, last_seen, message_count, sent_count, recv_count)
    select
      suggestion_user_id,
      r->>'handle',
      r->>'handle_norm',
      nullif(r->>'display_name', ''),
      nullif(r->>'last_seen', '')::timestamptz,
      coalesce((r->>'message_count')::int, 0),
      coalesce((r->>'sent_count')::int, 0),
      coalesce((r->>'recv_count')::int, 0)
    from jsonb_array_elements(suggestion_rows) as r
    where r->>'handle' is not null and r->>'handle_norm' is not null
    on conflict (user_id, handle_norm) do nothing
    returning 1
  )
  select count(*) into inserted_count from ins;
  return inserted_count;
end;
$$;

-- Suggestions the operator hasn't allowlisted yet, newest first.
create or replace function public.get_imessage_suggestions(query_user_id uuid)
returns table (
  handle text,
  handle_norm text,
  display_name text,
  last_seen timestamptz,
  message_count integer,
  sent_count integer,
  recv_count integer
)
language sql
security invoker
set search_path = ''
as $$
  select s.handle, s.handle_norm, s.display_name, s.last_seen, s.message_count, s.sent_count, s.recv_count
  from app_private.imessage_suggested_contacts s
  where s.user_id = query_user_id
    and not exists (
      select 1 from app_private.imessage_contact_allowlist a
      where a.user_id = s.user_id and a.handle_norm = s.handle_norm
    )
  order by s.last_seen desc nulls last;
$$;

revoke all on function public.replace_imessage_suggestions(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.get_imessage_suggestions(uuid) from public, anon, authenticated;
grant execute on function public.replace_imessage_suggestions(uuid, jsonb) to service_role;
grant execute on function public.get_imessage_suggestions(uuid) to service_role;
