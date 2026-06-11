create table public.canvas_extension_page_content (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  node_id uuid references public.canvas_extension_nodes(id) on delete cascade,
  canvas_origin text not null,
  url text not null,
  title text not null,
  content_markdown text not null,
  api_source text,
  source_snapshot_id uuid references public.source_snapshots(id) on delete set null,
  truncated boolean not null default false,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, canvas_origin, url)
);

create index canvas_extension_page_content_user_node_idx
  on public.canvas_extension_page_content(user_id, node_id);
create index canvas_extension_page_content_user_captured_idx
  on public.canvas_extension_page_content(user_id, captured_at desc);

alter table public.canvas_extension_page_content enable row level security;

create policy canvas_extension_page_content_select_own
  on public.canvas_extension_page_content for select to authenticated
  using ((select auth.uid()) = user_id);

create trigger canvas_extension_page_content_set_updated_at
  before update on public.canvas_extension_page_content
  for each row execute function public.set_updated_at();

comment on column public.canvas_extension_page_content.content_markdown is
  'Canvas Reader page content converted to sanitized markdown from the read-only Canvas REST API; must never contain credentials, bearer tokens, cookies, or executable page code.';
