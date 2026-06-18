-- Risk decisions — the "Needs you" rail lifecycle store.
--
-- Risks themselves stay derived and ephemeral: deriveRiskItems recomputes them
-- on every plan build and they are never persisted as their own rows. What we
-- DO persist is the operator's *decision* about a risk — snooze or dismiss —
-- so the attention rail can hide a parked item at read time without forcing a
-- replan, and the Archive can resurface a dismissed one.
--
-- Keyed by (user_id, risk_type, subject_key). subject_key is the stable identity
-- of a risk WITHIN its type: the task id for task-scoped risks (overdue,
-- deadline-without-block, unschedulable), or the affected day / week for the
-- aggregate risks (overloaded day, compression ahead). task_id is kept as a real
-- nullable FK when applicable so a deleted task cascades its parked decisions
-- away; aggregate risks leave it null and rely on subject_key alone.
--
-- This is the only new store in the rail refactor — "long-overdue" and
-- "dismissed" both resolve through here plus the existing tasks table
-- (status = missed), per the memory-store lesson: do not build a third data
-- store for something two existing homes already cover.

create table public.risk_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  risk_type text not null check (
    risk_type in (
      'overdue',
      'deadline_no_block',
      'unschedulable',
      'overloaded_day',
      'compression',
      'source_failed'
    )
  ),
  -- Stable identity within risk_type: task id for task-scoped risks, ISO day or
  -- ISO week for aggregate risks. Never null so the unique key is total.
  subject_key text not null,
  -- Real FK only for task-scoped risks, so task deletion cascades. Aggregate
  -- risks (overloaded day / compression) leave this null.
  task_id uuid references public.tasks(id) on delete cascade,
  -- Snooze: hide the item until this instant, then it returns. Null = not snoozed.
  dismissed_until timestamptz,
  -- Dismiss/archive: parked until explicitly un-archived. Null = active.
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one decision per (user, risk type, subject). Re-deciding upserts.
create unique index risk_decisions_user_type_subject_key
  on public.risk_decisions (user_id, risk_type, subject_key);

create index risk_decisions_user_idx on public.risk_decisions (user_id);

alter table public.risk_decisions enable row level security;

create policy risk_decisions_select_own on public.risk_decisions for select to authenticated using ((select auth.uid()) = user_id);
create policy risk_decisions_insert_own on public.risk_decisions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy risk_decisions_update_own on public.risk_decisions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy risk_decisions_delete_own on public.risk_decisions for delete to authenticated using ((select auth.uid()) = user_id);

create trigger risk_decisions_set_updated_at before update on public.risk_decisions for each row execute function public.set_updated_at();

revoke all on public.risk_decisions from anon, authenticated;
