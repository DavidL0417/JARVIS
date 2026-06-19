-- Fix: the claim RPC returned a single composite row, and PostgREST serializes a
-- composite-NULL (empty queue) as an all-null object rather than JSON null — so the
-- daemon mistook "no pending command" for a command with id=null and crash-looped on
-- /commands/complete. Return SETOF so an empty queue is an empty array (the daemon's
-- claim path already handles data[0]). Applied to prod before this commit.
drop function if exists public.claim_next_jarvis_note_command(uuid, text);

create function public.claim_next_jarvis_note_command(p_user_id uuid, p_worker text)
returns setof public.jarvis_note_commands
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id uuid;
begin
  select id into claimed_id
  from public.jarvis_note_commands
  where user_id = p_user_id and status = 'pending'
  order by created_at asc
  for update skip locked
  limit 1;

  if claimed_id is null then
    return;
  end if;

  return query
  update public.jarvis_note_commands
  set status = 'claimed', claimed_at = now(), claimed_by = p_worker, updated_at = now()
  where id = claimed_id
  returning *;
end;
$$;

revoke all on function public.claim_next_jarvis_note_command(uuid, text) from anon, authenticated;
