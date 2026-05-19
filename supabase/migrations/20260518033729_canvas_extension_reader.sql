create table if not exists app_private.canvas_extension_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  code_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'consumed', 'expired')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_private.canvas_extension_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  label text not null default 'JARVIS Canvas Reader',
  canvas_origin text,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists canvas_extension_pairing_codes_user_status_idx
  on app_private.canvas_extension_pairing_codes(user_id, status, expires_at desc);

create index if not exists canvas_extension_tokens_user_active_idx
  on app_private.canvas_extension_tokens(user_id, revoked_at, last_used_at desc);

alter table app_private.canvas_extension_pairing_codes enable row level security;
alter table app_private.canvas_extension_tokens enable row level security;

revoke all on app_private.canvas_extension_pairing_codes from public, anon, authenticated;
revoke all on app_private.canvas_extension_tokens from public, anon, authenticated;

grant usage on schema app_private to service_role;
grant select, insert, update, delete on app_private.canvas_extension_pairing_codes to service_role;
grant select, insert, update, delete on app_private.canvas_extension_tokens to service_role;

drop trigger if exists canvas_extension_pairing_codes_set_updated_at on app_private.canvas_extension_pairing_codes;
create trigger canvas_extension_pairing_codes_set_updated_at
  before update on app_private.canvas_extension_pairing_codes
  for each row execute function public.set_updated_at();

drop trigger if exists canvas_extension_tokens_set_updated_at on app_private.canvas_extension_tokens;
create trigger canvas_extension_tokens_set_updated_at
  before update on app_private.canvas_extension_tokens
  for each row execute function public.set_updated_at();

create or replace function public.create_canvas_extension_pairing_code(
  pairing_user_id uuid,
  pairing_code_hash text,
  pairing_expires_at timestamptz
)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into app_private.canvas_extension_pairing_codes (
    user_id,
    code_hash,
    status,
    expires_at
  )
  values (
    pairing_user_id,
    pairing_code_hash,
    'pending',
    pairing_expires_at
  );
$$;

create or replace function public.consume_canvas_extension_pairing_code(
  pairing_code_hash text,
  extension_token_hash text,
  extension_canvas_origin text
)
returns table (
  user_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  pairing_row app_private.canvas_extension_pairing_codes%rowtype;
begin
  select *
  into pairing_row
  from app_private.canvas_extension_pairing_codes
  where code_hash = pairing_code_hash
    and status = 'pending'
    and expires_at > now()
  limit 1
  for update;

  if not found then
    return;
  end if;

  update app_private.canvas_extension_pairing_codes
  set
    status = 'consumed',
    consumed_at = now(),
    updated_at = now()
  where id = pairing_row.id
    and status = 'pending';

  insert into app_private.canvas_extension_tokens (
    user_id,
    token_hash,
    label,
    canvas_origin
  )
  values (
    pairing_row.user_id,
    extension_token_hash,
    'JARVIS Canvas Reader',
    extension_canvas_origin
  );

  user_id := pairing_row.user_id;
  return next;
end;
$$;

create or replace function public.get_canvas_extension_token(
  extension_token_hash text
)
returns table (
  id uuid,
  user_id uuid,
  canvas_origin text,
  revoked_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  select
    canvas_extension_tokens.id,
    canvas_extension_tokens.user_id,
    canvas_extension_tokens.canvas_origin,
    canvas_extension_tokens.revoked_at
  from app_private.canvas_extension_tokens
  where canvas_extension_tokens.token_hash = extension_token_hash
    and canvas_extension_tokens.revoked_at is null
  limit 1;
$$;

create or replace function public.mark_canvas_extension_token_used(
  extension_token_id uuid,
  extension_canvas_origin text
)
returns void
language sql
security invoker
set search_path = ''
as $$
  update app_private.canvas_extension_tokens
  set
    canvas_origin = extension_canvas_origin,
    last_used_at = now(),
    updated_at = now()
  where id = extension_token_id
    and revoked_at is null;
$$;

revoke all on function public.create_canvas_extension_pairing_code(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.consume_canvas_extension_pairing_code(text, text, text) from public, anon, authenticated;
revoke all on function public.get_canvas_extension_token(text) from public, anon, authenticated;
revoke all on function public.mark_canvas_extension_token_used(uuid, text) from public, anon, authenticated;

grant execute on function public.create_canvas_extension_pairing_code(uuid, text, timestamptz) to service_role;
grant execute on function public.consume_canvas_extension_pairing_code(text, text, text) to service_role;
grant execute on function public.get_canvas_extension_token(text) to service_role;
grant execute on function public.mark_canvas_extension_token_used(uuid, text) to service_role;
