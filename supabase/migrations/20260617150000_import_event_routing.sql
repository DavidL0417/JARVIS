-- Import routing by kind: event-kind candidates become calendar events.
--
-- Until now every approved source candidate became a task (task/deadline/event
-- alike), which is why the TaskManager filled with imported fixed-time
-- commitments (recitals, juries, exam reminders). Route `event`-kind imports to
-- the schedule grid instead:
--
--   1) `schedule_events.source` gains 'imported' — a distinct provenance from
--      the synced 'calendar' mirror and the planner's 'task' blocks, so the
--      Google/CalDAV reconcilers (which delete by source='calendar'/'caldav')
--      never touch an imported event, and the planner's task-block churn
--      (source='task') leaves it alone.
--   2) `source_candidates.approved_event_id` mirrors `approved_task_id` so undo
--      can find and delete the created event, exactly as it does for tasks.

alter table public.schedule_events
  drop constraint if exists schedule_events_source_check;

alter table public.schedule_events
  add constraint schedule_events_source_check
  check (source in ('task', 'calendar', 'focus', 'imported'));

alter table public.source_candidates
  add column if not exists approved_event_id uuid;
