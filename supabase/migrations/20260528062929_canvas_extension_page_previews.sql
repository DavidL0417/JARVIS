alter table public.canvas_extension_commands
  drop constraint if exists canvas_extension_commands_type_check;

alter table public.canvas_extension_commands
  add constraint canvas_extension_commands_type_check
  check (type in ('discover', 'expand_node', 'import_selected', 'capture_url'));

comment on column public.canvas_extension_nodes.metadata is
  'Public Canvas Reader node metadata. May include sanitized inert page previews and same-origin read-only links; must never contain credentials, bearer tokens, cookies, raw captured archives, or executable page code.';
