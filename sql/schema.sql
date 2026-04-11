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
  scheduled_for timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tasks is 'Core task backlog used for dashboard stats and future scheduling.';

create table if not exists public.schedule_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  source text not null default 'task' check (source in ('task', 'calendar', 'focus')),
  status text check (status in ('todo', 'scheduled', 'completed', 'missed')),
  location text,
  external_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

comment on table public.schedule_events is 'Scheduled task or focus blocks that can later sync to Google Calendar.';

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
create index if not exists checkins_user_id_idx on public.checkins(user_id);
create index if not exists memory_logs_user_id_idx on public.memory_logs(user_id);

-- ##### END BACKEND #####
