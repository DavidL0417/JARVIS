create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  created_at timestamptz not null default now(),
  user_agent text,
  source text not null default 'landing'
);

create unique index if not exists waitlist_email_lower_unique
  on public.waitlist (lower(email));

alter table public.waitlist enable row level security;

revoke all on public.waitlist from anon, authenticated;

comment on table public.waitlist is 'Landing page email signups. Service-role only; RLS denies anon and authenticated by default.';
