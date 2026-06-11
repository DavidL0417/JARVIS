create table if not exists public.canvas_extension_command_events (
  id uuid primary key default gen_random_uuid(),
  command_id uuid references public.canvas_extension_commands(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  level text not null default 'info' check (level in ('info', 'success', 'warning', 'error')),
  phase text not null default 'status',
  node_id uuid references public.canvas_extension_nodes(id) on delete set null,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists canvas_extension_command_events_command_created_idx
  on public.canvas_extension_command_events(command_id, created_at desc);
create index if not exists canvas_extension_command_events_user_created_idx
  on public.canvas_extension_command_events(user_id, created_at desc);

alter table public.canvas_extension_command_events enable row level security;

drop policy if exists canvas_extension_command_events_select_own on public.canvas_extension_command_events;
create policy canvas_extension_command_events_select_own
  on public.canvas_extension_command_events for select to authenticated
  using ((select auth.uid()) = user_id);

drop trigger if exists canvas_extension_command_events_set_updated_at on public.canvas_extension_command_events;
create trigger canvas_extension_command_events_set_updated_at
  before update on public.canvas_extension_command_events
  for each row execute function public.set_updated_at();
