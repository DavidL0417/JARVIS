-- JARVIS note — durable, windowed idempotency for ambient-captured user lines.
--
-- Bug: runBrainOnCapture decided "new" by diffing the current capture against the
-- PREVIOUS capture's user lines. Overlapping captures (the ambient watcher firing on
-- JARVIS's own write, on note re-open, or a manual capture racing) read the SAME
-- stale baseline, so two captures both saw a line as new and both answered it →
-- duplicate replies.
--
-- Fix: a per-line claim with a TIME WINDOW. claim_jarvis_note_line atomically claims
-- a line (keyed by a hash of its normalized text, per user); it succeeds if the line
-- was never claimed OR was last claimed longer than p_window_seconds ago, and fails
-- if it was claimed within the window. So:
--   • racing/overlapping captures within the window → only one claims it (dedup), and
--   • a genuinely re-typed request after the window → re-answered (this is a command
--     surface; re-asking is legitimate), and
--   • a line whose answer threw → re-tried after the window (self-healing).
-- The PK + ON CONFLICT in one statement is the atomic CAS (no advisory lock needed).

create table public.jarvis_note_processed_lines (
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- sha256(hex) of the NORMALIZED line text (trim + collapse internal whitespace),
  -- so trivial whitespace diffs don't re-process; a real text edit hashes differently.
  line_hash text not null,
  line_text text not null,
  processed_at timestamptz not null default now(),
  primary key (user_id, line_hash)
);

create index jarvis_note_processed_lines_user_idx
  on public.jarvis_note_processed_lines (user_id, processed_at desc);

-- Windowed atomic claim. Returns true when THIS call wins the claim (process the
-- line); false when the line was claimed within the last p_window_seconds (skip).
create or replace function public.claim_jarvis_note_line(
  p_user_id uuid,
  p_line_hash text,
  p_line_text text,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean;
begin
  insert into public.jarvis_note_processed_lines (user_id, line_hash, line_text, processed_at)
  values (p_user_id, p_line_hash, p_line_text, now())
  on conflict (user_id, line_hash) do update
    set processed_at = now(), line_text = excluded.line_text
    where public.jarvis_note_processed_lines.processed_at
          < now() - make_interval(secs => p_window_seconds)
  returning true into v_claimed;
  -- A fresh insert OR a window-expired update returns a row (true). A conflict whose
  -- DO UPDATE WHERE is false (claimed within the window) updates nothing → null → false.
  return coalesce(v_claimed, false);
end;
$$;

alter table public.jarvis_note_processed_lines enable row level security;

create policy jarvis_note_processed_lines_select_own
  on public.jarvis_note_processed_lines
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.jarvis_note_processed_lines from anon, authenticated;
revoke all on function public.claim_jarvis_note_line(uuid, text, text, integer) from anon, authenticated;
