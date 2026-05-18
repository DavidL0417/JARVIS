do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.integrations'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%provider%'
  loop
    execute format('alter table public.integrations drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.integrations
  add constraint integrations_provider_check
  check (provider in ('google', 'notion', 'canvas', 'caldav'));

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'app_private.integration_tokens'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%provider%'
  loop
    execute format('alter table app_private.integration_tokens drop constraint %I', constraint_name);
  end loop;
end $$;

alter table app_private.integration_tokens
  add constraint integration_tokens_provider_check
  check (provider in ('google', 'notion', 'canvas', 'caldav'));

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
