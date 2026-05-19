create table public.canvas_extension_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token_id uuid not null,
  status text not null default 'connected' check (status in ('connected', 'disconnected', 'error')),
  extension_version text,
  canvas_origin text,
  active_url text,
  active_title text,
  active_command_id uuid,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id),
  unique (token_id)
);

create table public.canvas_extension_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('discover', 'expand_node', 'import_selected')),
  status text not null default 'pending' check (status in ('pending', 'running', 'cancel_requested', 'succeeded', 'failed', 'cancelled')),
  target_node_id uuid,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.canvas_extension_nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid references public.canvas_extension_nodes(id) on delete cascade,
  canvas_origin text not null,
  url text not null,
  title text not null,
  kind text not null default 'unknown' check (kind in ('course', 'section', 'page', 'assignment', 'module', 'file', 'discussion', 'calendar', 'external_link', 'unknown')),
  text_preview text,
  metadata jsonb not null default '{}'::jsonb,
  selected boolean not null default false,
  expanded boolean not null default false,
  imported_at timestamptz,
  source_snapshot_id uuid references public.source_snapshots(id) on delete set null,
  source_file_id uuid references public.source_files(id) on delete set null,
  discovered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, canvas_origin, url)
);

alter table public.canvas_extension_sessions
  add constraint canvas_extension_sessions_active_command_id_fkey
  foreign key (active_command_id) references public.canvas_extension_commands(id) on delete set null;

alter table public.canvas_extension_commands
  add constraint canvas_extension_commands_target_node_id_fkey
  foreign key (target_node_id) references public.canvas_extension_nodes(id) on delete set null;

create index canvas_extension_sessions_user_seen_idx
  on public.canvas_extension_sessions(user_id, last_seen_at desc);
create index canvas_extension_commands_user_status_idx
  on public.canvas_extension_commands(user_id, status, created_at desc);
create index canvas_extension_nodes_user_parent_idx
  on public.canvas_extension_nodes(user_id, parent_id, title);
create index canvas_extension_nodes_user_selected_idx
  on public.canvas_extension_nodes(user_id, selected, imported_at);

alter table public.canvas_extension_sessions enable row level security;
alter table public.canvas_extension_commands enable row level security;
alter table public.canvas_extension_nodes enable row level security;

create policy canvas_extension_sessions_select_own
  on public.canvas_extension_sessions for select to authenticated
  using ((select auth.uid()) = user_id);

create policy canvas_extension_commands_select_own
  on public.canvas_extension_commands for select to authenticated
  using ((select auth.uid()) = user_id);
create policy canvas_extension_commands_insert_own
  on public.canvas_extension_commands for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy canvas_extension_commands_update_own
  on public.canvas_extension_commands for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy canvas_extension_nodes_select_own
  on public.canvas_extension_nodes for select to authenticated
  using ((select auth.uid()) = user_id);
create policy canvas_extension_nodes_update_own
  on public.canvas_extension_nodes for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create trigger canvas_extension_sessions_set_updated_at
  before update on public.canvas_extension_sessions
  for each row execute function public.set_updated_at();

create trigger canvas_extension_commands_set_updated_at
  before update on public.canvas_extension_commands
  for each row execute function public.set_updated_at();

create trigger canvas_extension_nodes_set_updated_at
  before update on public.canvas_extension_nodes
  for each row execute function public.set_updated_at();
