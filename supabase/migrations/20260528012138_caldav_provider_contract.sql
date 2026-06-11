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

revoke all on function public.get_integration_token(uuid, text) from public, anon, authenticated;
grant execute on function public.get_integration_token(uuid, text) to service_role;
