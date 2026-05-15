# JARVIS Agent Instructions

This repo is now a production scheduler/secretary product, not a hackathon coordination workspace.

## Start Here

- Read this file before making repo changes.
- For durable decisions, use the docs in [`docs/decisions`](./docs/decisions).
- Do not use or recreate worklogs. They were removed intentionally.
- When architecture, schema, UI policy, or memory behavior changes, update the matching decision doc in the same change.

## Source Of Truth

- Supabase schema changes live in `supabase/migrations`.
- `sql/schema.sql` is a reference snapshot only when present; it is not the migration source of truth.
- Backend contracts live in `types` and `schemas`; routes and mappers must match those contracts exactly.
- Do not hide backend, auth, source-refresh, or calendar-sync failures behind placeholder/demo data.

## Product Direction

- JARVIS is a secretary-second-brain scheduler: it should combine tasks, calendar context, preferences, source snapshots, memory, and explicit tradeoffs before planning.
- Priorities are relative. Prefer zero-tradeoff plans that preserve due work, routines, sleep, and commitments when feasible.
- External sources beyond Google Calendar are modeled for now but not fully integrated in this pass.
- Treat exploratory product/design comments from the user as hypotheses to evaluate against the app's goals, not as automatic implementation directives. If the user clearly gives a correction or direct task, follow it; otherwise, reason through tradeoffs and choose the product-safe path.

## UI Direction

- Icon-first, minimal text, compact controls.
- Use concise empty/error/auth states instead of fake/demo content.
- Keep the main experience schedule-first and command-friendly.
- Avoid nested cards, marketing sections, decorative clutter, and explanatory UI copy.

## Safety

- Keep credentials and provider tokens out of exposed public tables.
- Enable RLS on every exposed public table.
- Destructive assistant actions and external calendar writes need explicit approval/change-plan handling.
