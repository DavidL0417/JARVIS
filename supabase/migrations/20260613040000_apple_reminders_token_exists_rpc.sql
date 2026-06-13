-- Lets the dashboard show an accurate Apple Reminders connection status without
-- exposing the private token table. security invoker → runs as service_role,
-- which already has SELECT on app_private.apple_reminders_tokens.
create or replace function public.user_has_apple_reminders_token(token_user_id uuid)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from app_private.apple_reminders_tokens
    where user_id = token_user_id and revoked_at is null
  );
$$;

revoke all on function public.user_has_apple_reminders_token(uuid) from public, anon, authenticated;
grant execute on function public.user_has_apple_reminders_token(uuid) to service_role;
