-- User-configurable planning horizon: how far ahead the planner reads calendar
-- events when building a schedule (in days). Bounded in the app to 7-56.
alter table public.preferences
  add column if not exists planner_horizon_days integer not null default 28;
