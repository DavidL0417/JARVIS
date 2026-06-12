-- Automation control plane.
--
-- `automation_settings` is the single switch that pauses all background work
-- (the daily cron and the local scheduled tasks). `automation_runs` is the
-- append-only audit of what each automation did or why it skipped — the
-- "earned silence" log surfaced in Settings → Activity.

create table public.automation_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  paused boolean not null default false,
  paused_until timestamptz,
  paused_reason text,
  updated_at timestamptz not null default now()
);

alter table public.automation_settings enable row level security;

create policy automation_settings_select_own on public.automation_settings for select to authenticated using ((select auth.uid()) = user_id);
create policy automation_settings_insert_own on public.automation_settings for insert to authenticated with check ((select auth.uid()) = user_id);
create policy automation_settings_update_own on public.automation_settings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy automation_settings_delete_own on public.automation_settings for delete to authenticated using ((select auth.uid()) = user_id);

create trigger automation_settings_set_updated_at before update on public.automation_settings for each row execute function public.set_updated_at();

revoke all on public.automation_settings from anon, authenticated;

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('source_refresh_cron', 'pre_plan_refresh', 'plan_build', 'reconciliation')),
  status text not null check (status in ('completed', 'skipped_paused', 'skipped_idle', 'failed')),
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index automation_runs_user_started_idx on public.automation_runs(user_id, started_at desc);

alter table public.automation_runs enable row level security;

create policy automation_runs_select_own on public.automation_runs for select to authenticated using ((select auth.uid()) = user_id);
create policy automation_runs_insert_own on public.automation_runs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy automation_runs_delete_own on public.automation_runs for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.automation_runs from anon, authenticated;
