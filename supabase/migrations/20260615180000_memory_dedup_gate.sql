-- Memory write-gate: content-identity uniqueness + one-time backlog collapse.
--
-- memory_items previously had no uniqueness on content, so every write path
-- (the secretary `remember` tool, source-candidate promotion, default-template
-- seeding, and manual edits) could insert duplicate facts. A non-atomic
-- check-then-insert in default seeding raced on first login and did exactly
-- that (14 rows written for 7 distinct template items in a single batch).
--
-- This migration makes "the same fact stored at most once per (user, layer)"
-- a table invariant rather than a per-path courtesy:
--   1) a deterministic normalized-content column (immutable, so it can back an
--      index),
--   2) a one-time hard-delete of pre-existing active duplicates so the unique
--      index can build (operator decision 2026-06-15: hard-delete the redundant
--      copies, keep the most authoritative one),
--   3) a partial unique index on active rows.
-- Duplicate inserts now raise 23505, which the application treats as an
-- idempotent no-op (see lib/assistant/memory-write.ts).
--
-- Modeled on the existing source_candidates_user_dedup_key precedent
-- (20260516040000 / 20260611120000): row_number() collapse, then a unique index.

-- 1) Deterministic identity for a memory's text: lowercased, trimmed, with
--    internal whitespace collapsed. lower/btrim/regexp_replace are all IMMUTABLE,
--    so this is valid as a stored generated column and as an index key. The
--    formula matches the read-time exact-dedupe key (trim + lowercase +
--    whitespace-collapse) so write-side and read-side agree on identity.
alter table public.memory_items
  add column if not exists content_norm text
  generated always as (regexp_replace(lower(btrim(content)), '\s+', ' ', 'g')) stored;

-- 2) Collapse pre-existing ACTIVE duplicates so the partial unique index can
--    build. Only active rows are constrained, so only active rows are collapsed;
--    archived/superseded tombstones are left untouched. Keep the most
--    authoritative row per (user_id, layer, content_norm): highest importance,
--    then most recent, then lowest id for determinism. Delete the rest.
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, layer, content_norm
      order by
        case importance
          when 'critical' then 0
          when 'high' then 1
          when 'medium' then 2
          else 3
        end,
        created_at desc,
        id
    ) as rn
  from public.memory_items
  where status = 'active'
)
delete from public.memory_items m
using ranked
where m.id = ranked.id
  and ranked.rn > 1;

-- 3) Enforce at most one ACTIVE row per (user, layer, normalized content).
--    Partial on status='active' so archived/superseded copies (the lifecycle
--    tombstones) can coexist with a live row of the same text.
create unique index if not exists memory_items_user_layer_content_key
  on public.memory_items (user_id, layer, content_norm)
  where status = 'active';
