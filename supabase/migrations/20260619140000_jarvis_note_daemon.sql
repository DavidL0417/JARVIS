-- JARVIS note daemon — the cloud half of the Raycast "JARVIS" note bridge.
--
-- The "JARVIS" Raycast note (id C8C158FD-…) is the operator's interactive surface
-- with the cloud JARVIS app. A local Mac daemon bridges it both ways:
--   • Capture (Mac → cloud): the daemon WAL-reads the note, diffs vs last-sent, and
--     POSTs new content here. Logged in jarvis_note_captures.
--   • Command (cloud → Mac): the cloud queues note-writes here; the daemon holds a
--     long-poll, claims the next command, writes the note via the shared Scheduler
--     SQLCipher writer, and reports completion.
--
-- Both are OPERATOR-ONLY (gated by RAYCAST_INGEST_SECRET / RAYCAST_OPERATOR_USER_ID,
-- same as the Raycast intake) and run only through the service-role admin client,
-- which bypasses RLS. The RLS policies below are select-own for a future dashboard
-- activity view; nothing on the authenticated path writes these tables.
--
-- The claim is a TRUE atomic compare-and-swap via claim_next_jarvis_note_command
-- (FOR UPDATE SKIP LOCKED) — deliberately NOT the Canvas extension's select-then-
-- update pattern, which races (two pollers can select the same pending row and both
-- mark it running). See docs/decisions/jarvis-note-daemon.md.

-- ── Command queue (cloud → Mac) ───────────────────────────────────────────────
create table public.jarvis_note_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- What the daemon should do to the JARVIS note:
  --   'append'       — add icon-tagged line(s) (payload.lines: string[])
  --   'confirm'      — add a "- [ ] ⚠️ Confirm: <action>? (#<ack_token>)" checkbox
  --                    (payload.action: string); requires_ack + ack_token are set
  --   'delete_lines' — surgically remove lines whose text matches (payload.match: string[])
  kind text not null check (kind in ('append', 'confirm', 'delete_lines')),
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'done', 'failed', 'canceled')),
  -- Write op; shape depends on kind, validated in the app by zod. Opaque to SQL.
  payload jsonb not null default '{}'::jsonb,
  -- Confirm handshake: a 'confirm' command embeds ack_token in the checkbox line;
  -- when the operator ticks it, the next capture reports the token and acked_at is set.
  requires_ack boolean not null default false,
  ack_token text,
  acked_at timestamptz,
  -- Claim, set atomically by claim_next_jarvis_note_command.
  claimed_at timestamptz,
  claimed_by text,
  -- Completion, reported by the daemon via the complete endpoint.
  completed_at timestamptz,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Hot path for the claim: the oldest pending command per user.
create index jarvis_note_commands_claimable
  on public.jarvis_note_commands (user_id, created_at)
  where status = 'pending';

-- A ticked checkbox maps to exactly one outstanding confirm.
create unique index jarvis_note_commands_ack_token
  on public.jarvis_note_commands (user_id, ack_token)
  where ack_token is not null;

-- ── Capture log (Mac → cloud) ─────────────────────────────────────────────────
create table public.jarvis_note_captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- The note's markdown at capture time (WAL-aware read on the Mac).
  note_markdown text not null,
  content_hash text not null,
  -- David's own lines, parsed (agent/icon-tagged lines excluded upstream).
  items jsonb not null default '[]'::jsonb,
  -- ack_tokens whose checkbox the operator has ticked as of this capture.
  acked_tokens text[] not null default '{}',
  -- Idle-skip: true when byte-identical to the prior capture (nothing new).
  unchanged boolean not null default false,
  created_at timestamptz not null default now()
);

create index jarvis_note_captures_user_idx
  on public.jarvis_note_captures (user_id, created_at desc);

-- ── Atomic claim (the correct CAS) ────────────────────────────────────────────
-- Selects the oldest pending command for the user, locks it FOR UPDATE SKIP LOCKED
-- (so a concurrent caller skips it rather than double-claiming), flips it to
-- 'claimed', and returns the row — all in one transaction. Returns NULL when the
-- queue is empty.
create or replace function public.claim_next_jarvis_note_command(p_user_id uuid, p_worker text)
returns public.jarvis_note_commands
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.jarvis_note_commands;
begin
  select * into claimed
  from public.jarvis_note_commands
  where user_id = p_user_id and status = 'pending'
  order by created_at asc
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.jarvis_note_commands
  set status = 'claimed', claimed_at = now(), claimed_by = p_worker, updated_at = now()
  where id = claimed.id
  returning * into claimed;

  return claimed;
end;
$$;

-- ── RLS + grants ──────────────────────────────────────────────────────────────
alter table public.jarvis_note_commands enable row level security;
alter table public.jarvis_note_captures enable row level security;

create policy jarvis_note_commands_select_own on public.jarvis_note_commands
  for select to authenticated using ((select auth.uid()) = user_id);
create policy jarvis_note_captures_select_own on public.jarvis_note_captures
  for select to authenticated using ((select auth.uid()) = user_id);

create trigger jarvis_note_commands_set_updated_at
  before update on public.jarvis_note_commands
  for each row execute function public.set_updated_at();

revoke all on public.jarvis_note_commands from anon, authenticated;
revoke all on public.jarvis_note_captures from anon, authenticated;
revoke all on function public.claim_next_jarvis_note_command(uuid, text) from anon, authenticated;
