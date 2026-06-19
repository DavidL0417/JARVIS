-- Phase 1 of Notion two-way sync writes tasks with last_synced_from='notion'
-- (so a JARVIS task can be matched back to its Notion page). The existing check
-- constraint only allowed local/caldav/apple_reminders, which would reject every
-- Notion-sourced task. Widen it to include 'notion'.
alter table tasks drop constraint if exists tasks_last_synced_from_check;
alter table tasks add constraint tasks_last_synced_from_check
  check (last_synced_from in ('local', 'caldav', 'apple_reminders', 'notion'));
