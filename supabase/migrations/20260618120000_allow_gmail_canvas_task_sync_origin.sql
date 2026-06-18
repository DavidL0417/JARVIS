-- Tasks now record their import origin in last_synced_from for Gmail and Canvas
-- too (not just the notion/caldav/apple_reminders mirrors), so the task pane can
-- group by source. Widen the check constraint to allow the new values.
alter table tasks drop constraint if exists tasks_last_synced_from_check;
alter table tasks add constraint tasks_last_synced_from_check
  check (last_synced_from in ('local', 'caldav', 'apple_reminders', 'notion', 'gmail', 'canvas'));
