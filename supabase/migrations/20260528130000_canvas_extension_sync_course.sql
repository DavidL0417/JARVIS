alter table public.canvas_extension_commands
  drop constraint if exists canvas_extension_commands_type_check;

alter table public.canvas_extension_commands
  add constraint canvas_extension_commands_type_check
  check (type in ('discover', 'expand_node', 'import_selected', 'capture_url', 'sync_course'));
