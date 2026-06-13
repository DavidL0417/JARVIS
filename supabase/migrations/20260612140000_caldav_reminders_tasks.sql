-- Apple Reminders (CalDAV VTODO) mirror into tasks.
--
-- Tasks gain an external id + sync origin so reminders ingest idempotently,
-- mirroring how schedule_events already track external calendar events. This is
-- a one-way mirror (phone -> Jarvis): reminders are immutable in Jarvis and
-- reconciled on every sync.

alter table public.tasks
  add column if not exists external_task_id text,
  add column if not exists last_synced_from text not null default 'local';

alter table public.tasks
  drop constraint if exists tasks_last_synced_from_check;

alter table public.tasks
  add constraint tasks_last_synced_from_check
  check (last_synced_from in ('local', 'caldav'));

-- Idempotent upsert key for mirrored reminders. NULLs are distinct in a unique
-- index, so local tasks (external_task_id is null) never collide with each other
-- or with mirrored ones.
create unique index if not exists tasks_user_external_task_id_idx
  on public.tasks(user_id, external_task_id);
