-- Dismiss becomes permanent.
--
-- Previously the dedup unique index was partial and excluded dismissed rows,
-- so a dismissed candidate could be re-imported on the next source refresh
-- (its key was not counted). We now treat dismissal as durable:
-- the same (user_id, kind, title, due_at, course) must never re-appear once
-- dismissed. A changed due date is a different key and still surfaces.

-- 1) Collapse any pre-existing key collisions so the full unique index can
--    build. Non-dismissed rows were already unique under the old partial index,
--    so the only possible duplicates involve dismissed rows. Keep the most
--    authoritative row per key (non-dismissed first, then earliest) and delete
--    the rest.
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, kind, title, due_at, course
      order by
        (case when status <> 'dismissed' then 0 else 1 end),
        created_at
    ) as rn
  from public.source_candidates
)
delete from public.source_candidates c
using ranked
where c.id = ranked.id
  and ranked.rn > 1;

-- 2) Swap the partial index for a full one covering every status.
drop index if exists public.source_candidates_user_dedup_key;

create unique index if not exists source_candidates_user_dedup_key
on public.source_candidates (user_id, kind, title, due_at, course)
nulls not distinct;
