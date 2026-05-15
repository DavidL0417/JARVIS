alter table public.memory_items
  add column if not exists layer text,
  add column if not exists payload jsonb not null default '{}'::jsonb;

update public.memory_items
set layer = case
  when kind = 'rule' then 'operating_rules'
  when kind = 'preference' then 'durable_preferences'
  when kind = 'task_context' then 'task_context'
  when kind = 'source_observation' then 'source_status'
  when kind = 'candidate' then 'candidate_memories'
  else 'feedback_observations'
end
where layer is null;

alter table public.memory_items
  alter column layer set default 'durable_preferences',
  alter column layer set not null,
  drop constraint if exists memory_items_layer_check,
  add constraint memory_items_layer_check
    check (layer in (
      'operating_rules',
      'planning_profile',
      'durable_preferences',
      'task_context',
      'deadline_context',
      'calendar_context',
      'source_status',
      'feedback_observations',
      'candidate_memories'
    ));

comment on column public.memory_items.layer is
  'Ordered secretary context layer used by the universal assistant runtime.';

comment on column public.memory_items.payload is
  'Structured secretary memory metadata, such as seed ids, source authority, and review hints.';

create index if not exists memory_items_user_layer_status_idx
  on public.memory_items(user_id, layer, status, created_at desc);

alter table public.assistant_tool_runs
  add column if not exists approved_at timestamptz,
  add column if not exists executed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists error_message text,
  drop constraint if exists assistant_tool_runs_status_check,
  add constraint assistant_tool_runs_status_check
    check (status in ('completed', 'clarification', 'error', 'pending_approval', 'cancelled'));

comment on column public.assistant_tool_runs.payload is
  'Tool execution payload. Pending approvals store the executable action plan here.';
