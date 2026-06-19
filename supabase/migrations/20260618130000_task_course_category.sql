-- Structured task facets: course + category.
--
-- Tasks already carried a freeform `tags text[]`, but the two facets that
-- actually drive the student surfaces — which course a task belongs to, and what
-- kind of work it is — were trapped there as undifferentiated strings (or, for
-- Notion relation properties, dropped entirely). Promoting them to first-class
-- nullable columns makes them queryable, filterable, and reliably surfaced as
-- chips, and lets the ingestion layer stop guessing.
--
--   course    the owning course, resolved to a human label (e.g. "MATH 240 —
--             Linear Algebra"). Notion: the Course relation, resolved to the
--             related page's title. Canvas: the assignment's context_name.
--   category  the kind of work (e.g. "Problem Set", "Reading", "Application").
--             Notion: the Category select. Canvas: the plannable type.
--
-- Both stay null when the source carries no such signal; nothing infers them.

alter table public.tasks
  add column if not exists course text,
  add column if not exists category text;

-- Filtering/grouping the task surfaces by course is the common read path; a
-- partial index keeps it cheap without bloating undated/uncoursed rows.
create index if not exists tasks_user_course_idx
  on public.tasks (user_id, course)
  where course is not null;
