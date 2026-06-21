-- Phase 3: per-user proactivity (digest) configuration.
--
-- Until now the digest dispatcher read hard-coded defaults (lib/digest/config.ts
-- DIGEST_DEFAULTS). These columns make the morning/evening planner cadence and a
-- "don't text me" quiet-hours window per-user — the config layer is multi-user
-- ready even though delivery stays operator-gated. Times are stored as HH:MM text
-- to match the app's string contract (the hhmm zod validators + the dispatcher's
-- parseHmToMinutes); quiet hours are nullable to mean "no quiet window".
alter table public.preferences
  add column if not exists morning_digest_enabled boolean not null default true;
alter table public.preferences
  add column if not exists evening_digest_enabled boolean not null default true;
alter table public.preferences
  add column if not exists morning_digest_time text not null default '08:30';
alter table public.preferences
  add column if not exists evening_digest_time text not null default '18:30';
alter table public.preferences
  add column if not exists quiet_hours_start text;
alter table public.preferences
  add column if not exists quiet_hours_end text;

-- The digest dispatcher records into the same "earned silence" audit log as the
-- other automations, but automation_runs.kind was never widened for it — so every
-- digest run insert was being rejected by the CHECK constraint and silently
-- swallowed (recordAutomationRun never throws). Widen kind to include the two
-- digest kinds, and add status 'skipped_quiet_hours' for the new quiet-hours gate.
alter table public.automation_runs
  drop constraint if exists automation_runs_kind_check;
alter table public.automation_runs
  add constraint automation_runs_kind_check
  check (kind in ('source_refresh_cron', 'pre_plan_refresh', 'plan_build', 'reconciliation', 'deadline_inference', 'morning_digest', 'evening_digest'));

alter table public.automation_runs
  drop constraint if exists automation_runs_status_check;
alter table public.automation_runs
  add constraint automation_runs_status_check
  check (status in ('completed', 'skipped_paused', 'skipped_idle', 'skipped_quiet_hours', 'failed'));
