-- Relocate legacy imported EVENTS that were created as tasks.
--
-- Before the W3 "import routing by kind" change, an event-kind source candidate
-- with a concrete time was persisted as an immutable, scheduled TASK. W3 fixed
-- the forward path (event-kind -> schedule_events, source='imported') but never
-- migrated the events already stranded in `tasks`, so they kept polluting the
-- task rail even though extraction had always classified them as events.
--
-- This backfill moves those stranded events onto the calendar where they belong,
-- then removes the task rows. Deadlines and plain tasks are untouched. Running it
-- again finds nothing once the rows are gone.

create temporary table _legacy_event_tasks on commit drop as
select t.id, t.user_id, t.title, t.scheduled_for, t.duration_minutes,
       t.priority, t.all_day, t.calendar_id
from tasks t
left join source_candidates sc on sc.id = t.source_candidate_id
where t.status = 'scheduled'
  and t.scheduled_for is not null
  and (sc.kind = 'event' or 'event' = any(t.tags));

-- 1) Event-tasks with no backing calendar row become fresh imported events.
insert into schedule_events (
  user_id, task_id, title, starts_at, ends_at, source, priority, status,
  location, external_event_id, gcal_event_id, last_synced_from,
  is_immutable, is_checked_in, all_day, calendar_id
)
select l.user_id, null, l.title,
       l.scheduled_for,
       l.scheduled_for + make_interval(mins => coalesce(l.duration_minutes, case when l.all_day then 1440 else 60 end)),
       'imported', l.priority, 'scheduled',
       null, null, null, 'local',
       true, true, coalesce(l.all_day, false), coalesce(l.calendar_id, 'cal-tasks')
from _legacy_event_tasks l
where not exists (select 1 from schedule_events se where se.task_id = l.id);

-- 2) Event-tasks that already have a planner-created block: repurpose that block
--    in place into a confirmed imported event (drop the task link).
update schedule_events se
set source = 'imported', task_id = null, is_immutable = true,
    is_checked_in = true, updated_at = now()
from _legacy_event_tasks l
where se.task_id = l.id;

-- 3) Remove the task rows. source_candidates.approved_task_id is ON DELETE SET
--    NULL, so the candidate survives (its dedup key still blocks re-import) with
--    a cleared task pointer.
delete from tasks t using _legacy_event_tasks l where t.id = l.id;
