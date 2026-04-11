-- Demo seed for the single MVP user used before auth/account switching is wired.
-- Safe scope: this script only resets data for demo@jarvis.local.

begin;

with demo_user as (
  insert into public.users (email, name)
  values ('demo@jarvis.local', 'JARVIS Demo User')
  on conflict (email) do update
    set name = excluded.name,
        updated_at = now()
  returning id
)
delete from public.schedule_events
where user_id = (select id from demo_user);

with demo_user as (
  insert into public.users (email, name)
  values ('demo@jarvis.local', 'JARVIS Demo User')
  on conflict (email) do update
    set name = excluded.name,
        updated_at = now()
  returning id
)
delete from public.checkins
where user_id = (select id from demo_user);

with demo_user as (
  insert into public.users (email, name)
  values ('demo@jarvis.local', 'JARVIS Demo User')
  on conflict (email) do update
    set name = excluded.name,
        updated_at = now()
  returning id
)
delete from public.memory_logs
where user_id = (select id from demo_user);

with demo_user as (
  insert into public.users (email, name)
  values ('demo@jarvis.local', 'JARVIS Demo User')
  on conflict (email) do update
    set name = excluded.name,
        updated_at = now()
  returning id
)
delete from public.tasks
where user_id = (select id from demo_user);

with demo_user as (
  insert into public.users (email, name)
  values ('demo@jarvis.local', 'JARVIS Demo User')
  on conflict (email) do update
    set name = excluded.name,
        updated_at = now()
  returning id
)
insert into public.preferences (
  user_id,
  timezone,
  sleep_pattern,
  peak_energy_window,
  procrastination_pattern,
  workday_start,
  workday_end,
  default_task_duration_minutes,
  break_duration_minutes,
  preferred_focus_block_minutes,
  preferred_checkin_mode,
  calendar_id
)
values (
  (select id from demo_user),
  'America/Chicago',
  'Usually asleep around 1:00 AM and slow to start before 9:30 AM.',
  'Late morning and early evening are most reliable for focused work.',
  'Long writing tasks get avoided unless there is a visible deadline or a concrete next step.',
  '09:30',
  '22:30',
  50,
  10,
  75,
  'quiet',
  'calendar-main'
)
on conflict (user_id) do update
set timezone = excluded.timezone,
    sleep_pattern = excluded.sleep_pattern,
    peak_energy_window = excluded.peak_energy_window,
    procrastination_pattern = excluded.procrastination_pattern,
    workday_start = excluded.workday_start,
    workday_end = excluded.workday_end,
    default_task_duration_minutes = excluded.default_task_duration_minutes,
    break_duration_minutes = excluded.break_duration_minutes,
    preferred_focus_block_minutes = excluded.preferred_focus_block_minutes,
    preferred_checkin_mode = excluded.preferred_checkin_mode,
    calendar_id = excluded.calendar_id,
    updated_at = now();

with demo_user as (
  insert into public.users (email, name)
  values ('demo@jarvis.local', 'JARVIS Demo User')
  on conflict (email) do update
    set name = excluded.name,
        updated_at = now()
  returning id
)
insert into public.tasks (
  user_id,
  title,
  description,
  deadline,
  duration_minutes,
  priority,
  status,
  is_immutable,
  calendar_id,
  tags,
  scheduled_for
)
values
  (
    (select id from demo_user),
    'Finish CS397 sprint outline',
    'Need a cleaner story for the demo: problem, planner loop, why recovery matters, and exactly what the UI should show first.',
    '2026-04-12T22:00:00-05:00',
    null,
    'high',
    'todo',
    false,
    'calendar-projects',
    array['project', 'CS397', 'Wildhacks 2026'],
    null
  ),
  (
    (select id from demo_user),
    'Study for MATH240 midterm practice set',
    null,
    '2026-04-14T21:00:00-05:00',
    null,
    'high',
    'todo',
    false,
    'calendar-academics',
    array['class', 'MATH240'],
    null
  ),
  (
    (select id from demo_user),
    'Draft LEGAL_ST221 policy memo',
    null,
    '2026-04-16T16:00:00-05:00',
    null,
    'high',
    'todo',
    false,
    'calendar-academics',
    array['class', 'LEGAL_ST221'],
    null
  ),
  (
    (select id from demo_user),
    'Revise Nisbet Research literature notes',
    'Pull out the two papers on student labor markets and write down what is actually useful before the meeting.',
    '2026-04-13T18:30:00-05:00',
    null,
    'medium',
    'todo',
    false,
    'calendar-research',
    array['research', 'Nisbet Research'],
    null
  ),
  (
    (select id from demo_user),
    'Submit Civis Analytics internship application',
    'Resume is close. Need short answers tightened and probably one better line about the scheduling project.',
    '2026-04-15T23:59:00-05:00',
    null,
    'high',
    'todo',
    false,
    'calendar-career',
    array['career', 'Internship', 'Applications'],
    null
  ),
  (
    (select id from demo_user),
    'Send recommendation follow-up email',
    null,
    '2026-04-12T15:00:00-05:00',
    null,
    'medium',
    'todo',
    false,
    'calendar-career',
    array['email', 'Career'],
    null
  ),
  (
    (select id from demo_user),
    'Laundry and room reset',
    null,
    null,
    null,
    'low',
    'todo',
    false,
    'calendar-personal',
    array['personal', 'Chores'],
    null
  ),
  (
    (select id from demo_user),
    'Read HISTORY382 chapter 8',
    null,
    '2026-04-14T11:00:00-05:00',
    null,
    'medium',
    'todo',
    false,
    'calendar-academics',
    array['class', 'HISTORY382'],
    null
  ),
  (
    (select id from demo_user),
    'Prepare PAD budget update',
    null,
    '2026-04-17T17:00:00-05:00',
    null,
    'medium',
    'todo',
    false,
    'calendar-extracurriculars',
    array['extracurricular', 'PAD'],
    null
  ),
  (
    (select id from demo_user),
    'Fix onboarding edge-case notes for JARVIS demo',
    'Need one short list of broken paths so the hackathon demo does not get derailed by onboarding weirdness.',
    '2026-04-12T20:00:00-05:00',
    null,
    'high',
    'todo',
    false,
    'calendar-projects',
    array['project', 'JARVIS', 'Wildhacks 2026'],
    null
  ),
  (
    (select id from demo_user),
    'Book coffee chat with alum',
    null,
    '2026-04-18T12:00:00-05:00',
    null,
    'low',
    'todo',
    false,
    'calendar-career',
    array['career', 'Networking'],
    null
  ),
  (
    (select id from demo_user),
    'Update resume bullet points',
    null,
    '2026-04-10T18:00:00-05:00',
    null,
    'medium',
    'completed',
    false,
    'calendar-career',
    array['career', 'Resume'],
    null
  ),
  (
    (select id from demo_user),
    'Review CS397 lecture notes',
    null,
    '2026-04-10T22:00:00-05:00',
    null,
    'medium',
    'completed',
    false,
    'calendar-academics',
    array['class', 'CS397'],
    null
  ),
  (
    (select id from demo_user),
    'Email TA about MATH240 extension question',
    null,
    '2026-04-09T14:00:00-05:00',
    null,
    'medium',
    'missed',
    false,
    'calendar-academics',
    array['class', 'MATH240', 'Email'],
    null
  ),
  (
    (select id from demo_user),
    'Outline Wildhacks pitch deck',
    null,
    '2026-04-13T19:00:00-05:00',
    null,
    'high',
    'todo',
    false,
    'calendar-projects',
    array['project', 'Wildhacks 2026', 'Pitch'],
    null
  ),
  (
    (select id from demo_user),
    'Fill out housing form',
    null,
    '2026-04-16T12:00:00-05:00',
    null,
    'high',
    'todo',
    false,
    'calendar-admin',
    array['admin', 'Housing'],
    null
  ),
  (
    (select id from demo_user),
    'Draft weekly research summary',
    'Keep it concise: main result, one open question, one thing to discuss next meeting.',
    '2026-04-14T18:00:00-05:00',
    null,
    'medium',
    'todo',
    false,
    'calendar-research',
    array['research', 'Nisbet Research', 'Writing'],
    null
  ),
  (
    (select id from demo_user),
    'Plan Sunday groceries',
    null,
    null,
    null,
    'low',
    'todo',
    false,
    'calendar-personal',
    array['personal', 'Errands'],
    null
  ),
  (
    (select id from demo_user),
    'Polish LinkedIn headline',
    null,
    '2026-04-18T17:00:00-05:00',
    null,
    'low',
    'todo',
    false,
    'calendar-career',
    array['career', 'LinkedIn'],
    null
  ),
  (
    (select id from demo_user),
    'Practice LEGAL_ST221 cold call notes',
    null,
    '2026-04-13T09:00:00-05:00',
    null,
    'medium',
    'todo',
    false,
    'calendar-academics',
    array['class', 'LEGAL_ST221'],
    null
  );

commit;
