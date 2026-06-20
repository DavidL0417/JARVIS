-- iMessage outbox — the cloud → Mac SEND channel for proactive digests + replies.
--
-- Phase 2 (proactivity v1): the cloud queues outbound iMessages here; a local Mac
-- send-daemon long-polls /outbox/poll, claims the next pending message (TRUE atomic
-- CAS via claim_next_imessage_outbox_command — FOR UPDATE SKIP LOCKED, the same
-- correct pattern as the JARVIS-note daemon, NOT the Canvas select-then-update race),
-- sends it through Messages.app (osascript), and reports the outcome to /outbox/complete.
--
-- OPERATOR-ONLY, gated exactly like the iMessage intake: IMESSAGE_INGEST_SECRET +
-- IMESSAGE_OPERATOR_USER_ID. Nothing on the authenticated path writes this table; only
-- the service-role admin client (which bypasses RLS) does. The select-own RLS policy
-- is for a future in-app activity view. See docs/decisions/operator-only-imessage.md.

create table public.imessage_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- iMessage recipient (the operator's own Apple ID / phone for self-delivery in v1).
  to_handle text not null,
  -- The message text to send.
  body text not null,
  -- What produced this message — drives the per-day idempotency key + analytics.
  kind text not null default 'manual'
    check (kind in ('morning_digest', 'evening_digest', 'reply', 'manual', 'test')),
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'sent', 'failed', 'canceled')),
  -- Idempotency: for scheduled digests the dispatcher sets this to
  -- '<kind>:<local-calendar-day>' so a re-fired cron (Vercel drift) can't double-send.
  -- The unique index enforces one row per (user, dedup_key); NULL = no dedup (replies/manual).
  dedup_key text,
  -- Claim, set atomically by claim_next_imessage_outbox_command.
  claimed_at timestamptz,
  claimed_by text,
  -- Completion, reported by the daemon via the complete endpoint.
  sent_at timestamptz,
  result jsonb,
  error text,
  -- Optional structured context (e.g. the task ids a digest referenced) for the
  -- reply loop to correlate an inbound "done" back to what was nagged. Opaque to SQL.
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Hot path for the claim: the oldest pending message per user.
create index imessage_outbox_claimable
  on public.imessage_outbox (user_id, created_at)
  where status = 'pending';

-- One scheduled message per (user, kind, day): the drift-proof dedup guard.
create unique index imessage_outbox_dedup
  on public.imessage_outbox (user_id, dedup_key)
  where dedup_key is not null;

create index imessage_outbox_user_idx
  on public.imessage_outbox (user_id, created_at desc);

-- ── Atomic claim (the correct CAS) ────────────────────────────────────────────
-- Selects the oldest pending message for the user, locks it FOR UPDATE SKIP LOCKED
-- (so a concurrent caller skips it rather than double-claiming), flips it to
-- 'claimed', and returns it. SETOF so an empty queue serializes as [] (not an
-- all-null composite object) — the daemon's claim path reads data[0].
create function public.claim_next_imessage_outbox_command(p_user_id uuid, p_worker text)
returns setof public.imessage_outbox
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id uuid;
begin
  select id into claimed_id
  from public.imessage_outbox
  where user_id = p_user_id and status = 'pending'
  order by created_at asc
  for update skip locked
  limit 1;

  if claimed_id is null then
    return;
  end if;

  return query
  update public.imessage_outbox
  set status = 'claimed', claimed_at = now(), claimed_by = p_worker, updated_at = now()
  where id = claimed_id
  returning *;
end;
$$;

-- ── RLS + grants ──────────────────────────────────────────────────────────────
alter table public.imessage_outbox enable row level security;

create policy imessage_outbox_select_own on public.imessage_outbox
  for select to authenticated using ((select auth.uid()) = user_id);

create trigger imessage_outbox_set_updated_at
  before update on public.imessage_outbox
  for each row execute function public.set_updated_at();

revoke all on public.imessage_outbox from anon, authenticated;
revoke all on function public.claim_next_imessage_outbox_command(uuid, text) from anon, authenticated;
