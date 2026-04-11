# David Worklog

## Log

### 2026-04-11 18:44 CDT

- Added [`sql/seed_demo_data.sql`](./../sql/seed_demo_data.sql) to reset and repopulate the single demo user with realistic sample preferences and a 20-task student workload across classes, research, career, extracurricular, admin, and personal categories.
- Kept the seeded task records aligned with the current product boundary: raw tasks carry `title`, optional `description`, `deadline`, `priority`, `status`, `calendarId`, `isImmutable`, and `tags`, while `duration_minutes` and `scheduled_for` stay `null` for later planner inference.
- Status: the repo now has a reusable mock task dataset for backend/demo testing without changing the shared contracts Eric already merged.
- Next step: apply the seed in Supabase or expose a lightweight seeding path so the demo user can be populated on demand before Claude scheduling is wired.

### 2026-04-11 18:20 CDT

- Merged the latest `origin/main` into `david-ai-calendar`, including the new persisted `tasks.tags` support and updated backend/shared task contracts.
- Confirmed the current data-model split: raw tasks now carry persisted categorization via `tags`, while planner-derived timing remains `scheduledFor` plus `durationMinutes`.
- Status: backend can now pass Claude task tags, immutable flags, and calendar IDs without any schema changes from David’s side.
- Next step: wire `lib/ai/claude.ts` to treat `tags` as the temporary class/extracurricular/project category signal and respect `isImmutable` / `calendarId` in planning output.

### 2026-04-11 17:34 CDT

- Merged the newest `main` backend updates into `david-ai-calendar`, including `is_immutable` / `calendar_id` support plus DB-backed schedule preparation context.
- Clarified the model boundary with the backend: raw task records remain the source of truth (`id`, `title`, optional `description`, `priority`, `status`, `dueAt`), while `scheduledFor` and `estimateMinutes` are planner-derived scheduling fields rather than user-entered source fields.
- Current connections still to be wired: Supabase task source cleanup for planner-ready raw tasks, preference capture, Google Calendar hard-event ingestion, and Claude planner output inside `lib/ai/claude.ts`.
- Immediate next step: implement `generateSchedule()` against the merged `SchedulePreparationContext` / `SchedulePlanResult` contracts and coordinate with Eric if raw-task creation should stop pre-filling planner-derived duration data.

### 2026-04-11 16:14 CDT

- Merged the latest `main` backend work into `david-ai-calendar`, including Supabase-backed onboarding and schedule preparation context.
- Clarified the planning boundary: raw task records are the source of truth (`id`, `title`, optional `description`, `priority`, `status`, `dueAt`), while `scheduledFor` and `estimateMinutes` are planner-derived outputs rather than user-entered fields.
- Current connections still to be wired: task source in Supabase, user preferences, hard calendar events, and Claude schedule/replan output in `lib/ai/claude.ts`.
- Next step: implement Claude planner output against the merged `SchedulePreparationContext` / `SchedulePlanResult` contracts without changing backend-owned schemas or routes.

### 2026-04-11 13:13 CDT

- Verified that duplicate uppercase worklog files were still present in the tracked tree after `HEAD` moved to a later merge commit.
- Removing `WORKLOG_DAVID.md`, `WORKLOG_ERIC.md`, and `WORKLOG_CINDY.md` so only the canonical lowercase worklogs remain.
- Status: current `HEAD` is being amended to delete the duplicate files for real.
- Next step: keep only the lowercase canonical worklogs in future commits.

### 2026-04-11 13:11 CDT

- Audited the worklog directory after duplicate contributor logs were created with uppercase/underscored filenames.
- Merged duplicate review results into the canonical lowercase worklogs and tightened `AGENTS.md` so future updates must reuse the canonical files in place.
- Status: duplicate worklog copies are being removed and the latest commit is being amended to preserve a single source of truth.
- Next step: continue logging only in `worklogs/WORKLOG-david.md`.

### 2026-04-11 12:50 CDT

- Updated contributor coordination in `AGENTS.md` to define explicit specialization areas for Cindy, Eric, and David.
- Status: frontend, backend/db, and AI/calendar ownership are now clearer for parallel work and handoffs.
- Next step: use these specialization defaults when assigning or documenting follow-up work across the repo.

### 2026-04-11 01:10 CDT

- Reorganized the repo so the Next.js frontend now lives under `frontend/`.
- Moved app code, frontend config, assets, and lockfiles out of the repo root into the new folder.
- Added a thin root `package.json` wrapper so `npm run dev/build/start/lint` still work from the repo root.
- Next step: keep new frontend work under `frontend/` unless the project becomes a multi-app repo with a clearer top-level structure.

### 2026-04-11 00:52 CDT

- Worked on repo workflow instructions and logging structure.
- Current focus: replaced the single shared worklog model with contributor-specific logs plus an integration-only main log.
- Status: `AGENTS.md` now defines the tentative tech stack, contributor identification by name, and the canonical log files for David, Eric, Cindy, and main integration.
- Next step: use this file for David's ongoing work and use `MAIN_UPDATE_LOG.md` only when combined work lands in `main`.

### 2026-04-11 00:00 America/Chicago

- Started contributor-specific worklog structure for David.
- Current focus: general and frontend work unless redirected.
- Status: initial log created as the canonical handoff file for David.
- Next step: append new entries here when David begins or completes meaningful work.
