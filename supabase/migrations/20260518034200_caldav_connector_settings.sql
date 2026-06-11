alter table public.integrations
  drop constraint if exists integrations_provider_check;

alter table public.integrations
  add constraint integrations_provider_check
  check (provider in ('google', 'notion', 'canvas', 'caldav'));

alter table app_private.integration_tokens
  drop constraint if exists integration_tokens_provider_check;

alter table app_private.integration_tokens
  add constraint integration_tokens_provider_check
  check (provider in ('google', 'notion', 'canvas', 'caldav'));

alter table public.calendars
  drop constraint if exists calendars_source_check;

alter table public.calendars
  add constraint calendars_source_check
  check (source in ('local', 'google', 'caldav', 'imported', 'task'));

alter table public.schedule_events
  drop constraint if exists schedule_events_last_synced_from_check;

alter table public.schedule_events
  add constraint schedule_events_last_synced_from_check
  check (last_synced_from in ('local', 'gcal', 'caldav'));

create unique index if not exists schedule_events_user_external_event_id_idx
  on public.schedule_events(user_id, external_event_id);

create table public.connector_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  connector_id text not null check (connector_id in ('google_calendar', 'gmail', 'notion', 'canvas', 'caldav')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, connector_id)
);

create index connector_settings_user_id_idx on public.connector_settings(user_id);

alter table public.connector_settings enable row level security;

create policy connector_settings_select_own on public.connector_settings for select to authenticated using ((select auth.uid()) = user_id);
create policy connector_settings_insert_own on public.connector_settings for insert to authenticated with check ((select auth.uid()) = user_id);
create policy connector_settings_update_own on public.connector_settings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy connector_settings_delete_own on public.connector_settings for delete to authenticated using ((select auth.uid()) = user_id);

create trigger connector_settings_set_updated_at before update on public.connector_settings for each row execute function public.set_updated_at();

revoke all on public.connector_settings from anon, authenticated;

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
security invoker
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
    and token_provider in ('google', 'notion', 'canvas', 'caldav')
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
security invoker
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
