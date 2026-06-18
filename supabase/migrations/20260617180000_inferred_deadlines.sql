-- Inferred deadlines (Workstream 2): suggest a by-when for undated tasks.
--
-- Undated tasks never enter the overdue/missed lifecycle (the rules key off
-- deadline < now, which a null deadline never matches), so their real risk is
-- going invisible. When a concrete anchor makes a deadline logically follow (a
-- dated trip, a dated event, an explicit dependency), JARVIS infers a *suggested*
-- by-when and surfaces it for approval — it is never written to `deadline`
-- silently (approval before destruction). The suggestion is cached on the task;
-- the rail and the Deadlines review surface read the cached value.
--
--   inferred_deadline           the suggested by-when (null = no suggestion)
--   inferred_deadline_reason    the anchor + reasoning, always shown with it
--   inferred_deadline_dismissed the operator chose "Keep undated" — suppresses
--                               re-suggestion so JARVIS does not nag.

alter table public.tasks
  add column if not exists inferred_deadline timestamptz,
  add column if not exists inferred_deadline_reason text,
  add column if not exists inferred_deadline_dismissed boolean not null default false;

-- Audit the inference pass in the same "earned silence" log as the other
-- automations.
alter table public.automation_runs
  drop constraint if exists automation_runs_kind_check;

alter table public.automation_runs
  add constraint automation_runs_kind_check
  check (kind in ('source_refresh_cron', 'pre_plan_refresh', 'plan_build', 'reconciliation', 'deadline_inference'));
