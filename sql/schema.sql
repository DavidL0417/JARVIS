-- ##### BACKEND API #####
-- DO NOT MODIFY UNLESS BACKEND OWNER
-- Canonical MVP Supabase schema for the current DB-backed dashboard and onboarding routes.

create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.users is 'MVP identity table for JARVIS. A single demo user can be used before auth is wired.';

create table if not exists public.preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  timezone text not null default 'America/Chicago',
  sleep_pattern text,
  peak_energy_window text,
  procrastination_pattern text,
  workday_start time not null default '09:00',
  workday_end time not null default '17:00',
  default_task_duration_minutes integer not null default 50 check (default_task_duration_minutes > 0),
  break_duration_minutes integer not null default 10 check (break_duration_minutes >= 0),
  preferred_focus_block_minutes integer check (preferred_focus_block_minutes > 0),
  preferred_checkin_mode text not null default 'quiet' check (preferred_checkin_mode in ('silent', 'quiet', 'gentle', 'active')),
  calendar_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

comment on table public.preferences is 'Lightweight behavioral and scheduling defaults used to personalize planning.';

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  description text,
  deadline timestamptz,
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status text not null default 'todo' check (status in ('todo', 'scheduled', 'completed', 'missed')),
  is_immutable boolean not null default false,
  calendar_id text,
  tags text[] not null default '{}'::text[],
  scheduled_for timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tasks is 'Core task backlog used for dashboard stats and future scheduling.';

alter table public.tasks
  add column if not exists tags text[] not null default '{}'::text[];

create table if not exists public.schedule_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  source text not null default 'task' check (source in ('task', 'calendar', 'focus')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status text check (status in ('todo', 'scheduled', 'completed', 'missed')),
  is_immutable boolean not null default false,
  is_checked_in boolean not null default false,
  calendar_id text,
  location text,
  external_event_id text,
  gcal_event_id text,
  last_synced_from text not null default 'local' check (last_synced_from in ('local', 'gcal')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

comment on table public.schedule_events is 'Canonical calendar-event store. Sync flows must read GCal into Supabase first, then let the frontend read from Supabase. Google Tasks API content is intentionally ignored.';

create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  mood text check (mood in ('good', 'okay', 'stuck')),
  energy text check (energy in ('low', 'medium', 'high')),
  outcome text not null default 'partial' check (outcome in ('completed', 'missed', 'partial')),
  note text,
  blockers text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

comment on table public.checkins is 'Small check-in log used to infer whether the user is active, stuck, or silent.';

create table if not exists public.memory_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  category text not null default 'behavior',
  insight text not null,
  confidence numeric(3,2),
  source text not null default 'manual',
  created_at timestamptz not null default now()
);


comment on table public.memory_logs is 'Distilled behavioral insights generated from onboarding and future check-ins.';

create index if not exists tasks_user_id_idx on public.tasks(user_id);
create index if not exists tasks_deadline_idx on public.tasks(deadline);
create index if not exists schedule_events_user_id_idx on public.schedule_events(user_id);
create index if not exists schedule_events_task_id_idx on public.schedule_events(task_id);
create unique index if not exists schedule_events_user_gcal_event_id_idx on public.schedule_events(user_id, gcal_event_id) where gcal_event_id is not null;
create index if not exists checkins_user_id_idx on public.checkins(user_id);
create index if not exists memory_logs_user_id_idx on public.memory_logs(user_id);


alter table public.tasks
  add column if not exists all_day boolean not null default false;

alter table public.schedule_events
  add column if not exists all_day boolean not null default false;

alter table public.schedule_events
  add column if not exists priority text not null default 'medium' check (priority in ('low', 'medium', 'high'));

alter table public.schedule_events
  add column if not exists is_checked_in boolean not null default false;

alter table public.schedule_events
  add column if not exists gcal_event_id text;

alter table public.schedule_events
  add column if not exists last_synced_from text not null default 'local' check (last_synced_from in ('local', 'gcal'));

alter table public.schedule_events
  alter column priority set default 'medium';

comment on column public.schedule_events.priority is 'Scheduling priority mirrored into Google Calendar extendedProperties. Default is medium.';
comment on column public.schedule_events.is_immutable is 'When true, DB-level guards reject updates and deletes.';
comment on column public.schedule_events.is_checked_in is 'Only checked-in events may have their priority changed during a manual save flow.';
comment on column public.schedule_events.gcal_event_id is 'Google Calendar event id used for one-to-one sync reconciliation.';
comment on column public.schedule_events.last_synced_from is 'Loop-prevention marker. local = JARVIS/Supabase initiated the last change, gcal = Google Calendar initiated it.';

alter table public.users
  alter column id drop default;

alter table public.users
  alter column name set default '';

alter table public.users
  add column if not exists avatar_url text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'users_auth_users_id_fkey'
  ) then
    alter table public.users
      add constraint users_auth_users_id_fkey
      foreign key (id) references auth.users(id) on delete cascade not valid;
  end if;
end
$$;

create table if not exists public.user_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check (provider in ('google')),
  provider_account_email text,
  provider_user_id text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  status text not null default 'connected' check (status in ('connected', 'needs_reauth', 'disconnected', 'error')),
  selected_calendar_id text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create index if not exists user_integrations_user_id_idx on public.user_integrations(user_id);
create unique index if not exists schedule_events_user_task_source_key
  on public.schedule_events(user_id, task_id, source);

create table if not exists public.user_calendars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  calendar_key text not null,
  name text not null,
  color text not null default '#f9a8d4',
  source text not null default 'local' check (source in ('local', 'google', 'imported', 'task')),
  google_calendar_id text,
  remote_name text,
  is_visible boolean not null default true,
  is_immutable boolean not null default false,
  sync_preference text not null default 'active' check (sync_preference in ('active', 'pending', 'ignored')),
  is_task_calendar boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, calendar_key)
);

comment on table public.user_calendars is 'Per-user calendar registry. Includes the Task Calendar mirror metadata used for Google Calendar sync.';

create unique index if not exists user_calendars_user_google_calendar_id_idx
  on public.user_calendars(user_id, google_calendar_id)
  where google_calendar_id is not null;
create unique index if not exists user_calendars_user_task_calendar_idx
  on public.user_calendars(user_id)
  where is_task_calendar = true;
create unique index if not exists user_calendars_user_local_name_idx
  on public.user_calendars(user_id, lower(name))
  where source in ('local', 'task');
create index if not exists user_calendars_user_id_idx on public.user_calendars(user_id);

alter table public.tasks enable row level security;
alter table public.schedule_events enable row level security;
alter table public.user_calendars enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tasks'
      and policyname = 'tasks_select_own'
  ) then
    create policy tasks_select_own
      on public.tasks
      for select
      to authenticated
      using (auth.uid() = user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tasks'
      and policyname = 'tasks_insert_own'
  ) then
    create policy tasks_insert_own
      on public.tasks
      for insert
      to authenticated
      with check (auth.uid() = user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tasks'
      and policyname = 'tasks_update_mutable_own'
  ) then
    create policy tasks_update_mutable_own
      on public.tasks
      for update
      to authenticated
      using (auth.uid() = user_id and is_immutable = false)
      with check (auth.uid() = user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tasks'
      and policyname = 'tasks_delete_mutable_own'
  ) then
    create policy tasks_delete_mutable_own
      on public.tasks
      for delete
      to authenticated
      using (auth.uid() = user_id and is_immutable = false);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'schedule_events'
      and policyname = 'schedule_events_select_own'
  ) then
    create policy schedule_events_select_own
      on public.schedule_events
      for select
      to authenticated
      using (auth.uid() = user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'schedule_events'
      and policyname = 'schedule_events_insert_own'
  ) then
    create policy schedule_events_insert_own
      on public.schedule_events
      for insert
      to authenticated
      with check (auth.uid() = user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'schedule_events'
      and policyname = 'schedule_events_update_mutable_own'
  ) then
    create policy schedule_events_update_mutable_own
      on public.schedule_events
      for update
      to authenticated
      using (auth.uid() = user_id and is_immutable = false)
      with check (auth.uid() = user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'schedule_events'
      and policyname = 'schedule_events_delete_mutable_own'
  ) then
    create policy schedule_events_delete_mutable_own
      on public.schedule_events
      for delete
      to authenticated
      using (auth.uid() = user_id and is_immutable = false);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_calendars'
      and policyname = 'user_calendars_select_own'
  ) then
    create policy user_calendars_select_own
      on public.user_calendars
      for select
      to authenticated
      using (auth.uid() = user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_calendars'
      and policyname = 'user_calendars_insert_own'
  ) then
    create policy user_calendars_insert_own
      on public.user_calendars
      for insert
      to authenticated
      with check (auth.uid() = user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_calendars'
      and policyname = 'user_calendars_update_own'
  ) then
    create policy user_calendars_update_own
      on public.user_calendars
      for update
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_calendars'
      and policyname = 'user_calendars_delete_own'
  ) then
    create policy user_calendars_delete_own
      on public.user_calendars
      for delete
      to authenticated
      using (auth.uid() = user_id);
  end if;
end
$$;

create or replace function public.prevent_immutable_row_changes()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'schedule_events'
    and tg_op = 'UPDATE'
    and old.is_immutable
    and coalesce(old.is_checked_in, false) = false
    and coalesce(new.is_checked_in, false) = true
    and new.starts_at is not distinct from old.starts_at
    and new.ends_at is not distinct from old.ends_at
    and new.title is not distinct from old.title
    and new.location is not distinct from old.location
    and new.gcal_event_id is not distinct from old.gcal_event_id
  then
    return new;
  end if;

  if old.is_immutable then
    raise exception 'Immutable rows cannot be updated or deleted.'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create or replace function public.enforce_schedule_event_priority_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
    and new.priority is distinct from old.priority
    and coalesce(old.is_checked_in, false) = false
    and coalesce(new.is_checked_in, false) = false
  then
    raise exception 'Priority can only change after a check-in is completed and explicitly saved.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_immutable_task_changes on public.tasks;
create trigger prevent_immutable_task_changes
before update or delete on public.tasks
for each row
execute function public.prevent_immutable_row_changes();

drop trigger if exists prevent_immutable_schedule_event_changes on public.schedule_events;
create trigger prevent_immutable_schedule_event_changes
before update or delete on public.schedule_events
for each row
execute function public.prevent_immutable_row_changes();

drop trigger if exists enforce_schedule_event_priority_guard on public.schedule_events;
create trigger enforce_schedule_event_priority_guard
before update on public.schedule_events
for each row
execute function public.enforce_schedule_event_priority_guard();


-- ##### END BACKEND #####
