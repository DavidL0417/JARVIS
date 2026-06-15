-- Add a short message preview to suggested contacts so the operator can identify a
-- number-only suggestion (no Contacts name) by its recent texts. The reader attaches
-- the ~5 most recent messages per suggestion; these are transient (replace-all each
-- run) and operator-only, like the rest of the suggestion data.

alter table app_private.imessage_suggested_contacts
  add column if not exists recent_messages jsonb not null default '[]'::jsonb;

-- Re-create the replace RPC to also store the preview array (jsonb passthrough).
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
      (user_id, handle, handle_norm, display_name, last_seen, message_count, sent_count, recv_count, recent_messages)
    select
      suggestion_user_id,
      r->>'handle',
      r->>'handle_norm',
      nullif(r->>'display_name', ''),
      nullif(r->>'last_seen', '')::timestamptz,
      coalesce((r->>'message_count')::int, 0),
      coalesce((r->>'sent_count')::int, 0),
      coalesce((r->>'recv_count')::int, 0),
      coalesce(r->'recent_messages', '[]'::jsonb)
    from jsonb_array_elements(suggestion_rows) as r
    where r->>'handle' is not null and r->>'handle_norm' is not null
    on conflict (user_id, handle_norm) do nothing
    returning 1
  )
  select count(*) into inserted_count from ins;
  return inserted_count;
end;
$$;

-- Re-create the get RPC to return the preview array. Its return type changes (new
-- column), so it must be dropped before recreating.
drop function if exists public.get_imessage_suggestions(uuid);
create or replace function public.get_imessage_suggestions(query_user_id uuid)
returns table (
  handle text,
  handle_norm text,
  display_name text,
  last_seen timestamptz,
  message_count integer,
  sent_count integer,
  recv_count integer,
  recent_messages jsonb
)
language sql
security invoker
set search_path = ''
as $$
  select s.handle, s.handle_norm, s.display_name, s.last_seen, s.message_count, s.sent_count, s.recv_count, s.recent_messages
  from app_private.imessage_suggested_contacts s
  where s.user_id = query_user_id
    and not exists (
      select 1 from app_private.imessage_contact_allowlist a
      where a.user_id = s.user_id and a.handle_norm = s.handle_norm
    )
  order by s.last_seen desc nulls last;
$$;

grant execute on function public.replace_imessage_suggestions(uuid, jsonb) to service_role;
grant execute on function public.get_imessage_suggestions(uuid) to service_role;
