-- Graceful re-entry: a planned task block whose end time has passed but which
-- was never confirmed done or missed becomes "unconfirmed" — a plan is not a
-- completion. Tasks keep their existing status set; only schedule_events gains
-- the new value.

alter table public.schedule_events
  drop constraint if exists schedule_events_status_check;

alter table public.schedule_events
  add constraint schedule_events_status_check
  check (status in ('todo', 'scheduled', 'completed', 'missed', 'unconfirmed'));
