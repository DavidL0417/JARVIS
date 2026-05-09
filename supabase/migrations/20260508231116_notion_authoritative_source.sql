alter table public.integrations
  add column if not exists selected_source_id text,
  add column if not exists selected_source_name text;

comment on column public.integrations.selected_source_id is
  'Provider-specific authoritative source id, such as a Notion tasks database id.';

comment on column public.integrations.selected_source_name is
  'Provider-specific authoritative source label displayed in source setup UI.';
