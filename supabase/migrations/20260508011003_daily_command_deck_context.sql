alter table public.integrations
  drop constraint if exists integrations_provider_check;

alter table public.integrations
  add constraint integrations_provider_check
  check (provider in ('google', 'notion'));

alter table app_private.integration_tokens
  drop constraint if exists integration_tokens_provider_check;

alter table app_private.integration_tokens
  add constraint integration_tokens_provider_check
  check (provider in ('google', 'notion'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'source-originals',
  'source-originals',
  false,
  52428800,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain',
    'text/markdown',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.source_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source text not null check (source in ('notion', 'gmail', 'caldav', 'google_calendar', 'manual', 'system')),
  source_ref text,
  file_name text not null,
  mime_type text not null,
  storage_path text not null,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  status text not null default 'ready' check (status in ('uploading', 'ready', 'processing', 'processed', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, storage_path)
);

create table public.source_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_snapshot_id uuid references public.source_snapshots(id) on delete set null,
  source_file_id uuid references public.source_files(id) on delete set null,
  kind text not null check (kind in ('task', 'deadline', 'event', 'routine', 'preference', 'note')),
  title text not null,
  description text,
  course text,
  due_at timestamptz,
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  confidence numeric(3,2) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  evidence text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'dismissed')),
  approved_task_id uuid references public.tasks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.daily_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  horizon_start timestamptz not null,
  horizon_end timestamptz not null,
  status text not null default 'ready' check (status in ('draft', 'ready', 'error', 'superseded')),
  summary text not null,
  now_item jsonb,
  next_items jsonb not null default '[]'::jsonb,
  risk_items jsonb not null default '[]'::jsonb,
  tradeoffs jsonb not null default '[]'::jsonb,
  source_coverage jsonb not null default '[]'::jsonb,
  command text,
  model text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (horizon_end > horizon_start)
);

alter table public.tasks
  add column if not exists source_candidate_id uuid references public.source_candidates(id) on delete set null,
  add column if not exists plan_id uuid references public.daily_plans(id) on delete set null;

alter table public.schedule_events
  add column if not exists plan_id uuid references public.daily_plans(id) on delete set null;

create index source_files_user_source_idx on public.source_files(user_id, source, created_at desc);
create index source_candidates_user_status_idx on public.source_candidates(user_id, status, created_at desc);
create index source_candidates_user_due_at_idx on public.source_candidates(user_id, due_at);
create index daily_plans_user_created_idx on public.daily_plans(user_id, created_at desc);
create index tasks_source_candidate_id_idx on public.tasks(source_candidate_id);
create index tasks_plan_id_idx on public.tasks(plan_id);
create index schedule_events_plan_id_idx on public.schedule_events(plan_id);

alter table public.source_files enable row level security;
alter table public.source_candidates enable row level security;
alter table public.daily_plans enable row level security;

create policy source_files_select_own on public.source_files for select to authenticated using ((select auth.uid()) = user_id);
create policy source_files_insert_own on public.source_files for insert to authenticated with check ((select auth.uid()) = user_id);
create policy source_files_update_own on public.source_files for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy source_files_delete_own on public.source_files for delete to authenticated using ((select auth.uid()) = user_id);

create policy source_candidates_select_own on public.source_candidates for select to authenticated using ((select auth.uid()) = user_id);
create policy source_candidates_insert_own on public.source_candidates for insert to authenticated with check ((select auth.uid()) = user_id);
create policy source_candidates_update_own on public.source_candidates for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy source_candidates_delete_own on public.source_candidates for delete to authenticated using ((select auth.uid()) = user_id);

create policy daily_plans_select_own on public.daily_plans for select to authenticated using ((select auth.uid()) = user_id);
create policy daily_plans_insert_own on public.daily_plans for insert to authenticated with check ((select auth.uid()) = user_id);
create policy daily_plans_update_own on public.daily_plans for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy daily_plans_delete_own on public.daily_plans for delete to authenticated using ((select auth.uid()) = user_id);

create policy source_originals_select_own on storage.objects for select to authenticated using (
  bucket_id = 'source-originals'
  and (select auth.uid())::text = split_part(name, '/', 1)
);

create policy source_originals_insert_own on storage.objects for insert to authenticated with check (
  bucket_id = 'source-originals'
  and (select auth.uid())::text = split_part(name, '/', 1)
);

create policy source_originals_update_own on storage.objects for update to authenticated using (
  bucket_id = 'source-originals'
  and (select auth.uid())::text = split_part(name, '/', 1)
) with check (
  bucket_id = 'source-originals'
  and (select auth.uid())::text = split_part(name, '/', 1)
);

create policy source_originals_delete_own on storage.objects for delete to authenticated using (
  bucket_id = 'source-originals'
  and (select auth.uid())::text = split_part(name, '/', 1)
);

create trigger source_files_set_updated_at before update on public.source_files for each row execute function public.set_updated_at();
create trigger source_candidates_set_updated_at before update on public.source_candidates for each row execute function public.set_updated_at();
create trigger daily_plans_set_updated_at before update on public.daily_plans for each row execute function public.set_updated_at();

grant usage on schema app_private to service_role;
grant select, insert, update on app_private.integration_tokens to service_role;

create or replace function public.get_integration_token(
  token_user_id uuid,
  token_provider text
)
returns table (
  id uuid,
  user_id uuid,
  provider text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select
    integration_tokens.id,
    integration_tokens.user_id,
    integration_tokens.provider,
    integration_tokens.access_token,
    integration_tokens.refresh_token,
    integration_tokens.expires_at,
    integration_tokens.scope,
    integration_tokens.created_at,
    integration_tokens.updated_at
  from app_private.integration_tokens
  where integration_tokens.user_id = token_user_id
    and integration_tokens.provider = token_provider
    and token_provider in ('google', 'notion')
  limit 1;
$$;

create or replace function public.upsert_integration_token(
  token_user_id uuid,
  token_provider text,
  token_access_token text,
  token_refresh_token text,
  token_expires_at timestamptz,
  token_scope text
)
returns void
language sql
set search_path = ''
as $$
  insert into app_private.integration_tokens (
    user_id,
    provider,
    access_token,
    refresh_token,
    expires_at,
    scope
  )
  values (
    token_user_id,
    token_provider,
    token_access_token,
    token_refresh_token,
    token_expires_at,
    token_scope
  )
  on conflict (user_id, provider) do update set
    access_token = excluded.access_token,
    refresh_token = excluded.refresh_token,
    expires_at = excluded.expires_at,
    scope = excluded.scope,
    updated_at = now();
$$;

revoke all on function public.get_integration_token(uuid, text) from public, anon, authenticated;
revoke all on function public.upsert_integration_token(uuid, text, text, text, timestamptz, text) from public, anon, authenticated;

grant execute on function public.get_integration_token(uuid, text) to service_role;
grant execute on function public.upsert_integration_token(uuid, text, text, text, timestamptz, text) to service_role;
