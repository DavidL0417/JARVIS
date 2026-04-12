# David Worklog

## Log

### 2026-04-11 22:22 CDT

- Fixed the actual 7-day navigation bug in [`components/dashboard/schedule-view.tsx`](./../components/dashboard/schedule-view.tsx): the visible range was still snapping back to Monday, which made left/right clicks appear broken until seven presses crossed into the next week.
- Removed that Monday anchoring from the displayed date window and range label, so 7-day is now a rolling 7-day strip instead of a fixed calendar week.
- Updated [`lib/mock-calendar-events.ts`](./../lib/mock-calendar-events.ts) so the placeholder schedule still opens on April 6 after converting 7-day into a rolling window.
- Status: one left/right click should now move the visible 7-day schedule by exactly one day.
- Next step: none unless we want a separate “calendar week” mode distinct from the rolling 7-day mode.

### 2026-04-11 22:16 CDT

- Normalized the remaining legacy calendar-store navigation logic in [`lib/stores/calendar-store.ts`](./../lib/stores/calendar-store.ts) so day-based views move by one day per click instead of jumping by 3 or 7 days.
- Confirmed the active [`components/dashboard/schedule-view.tsx`](./../components/dashboard/schedule-view.tsx) path was already using one-day stepping, so this change removes stale behavior in the alternate store-backed path rather than altering the current backend-wired schedule panel.
- Status: 1-day, 3-day, and 7-day forward/back navigation are now consistent across the codebase.
- Next step: none for this behavior unless we later want separate “jump by span” controls in addition to daily stepping.

### 2026-04-11 22:00 CDT

- Replaced the sparse backend calendar feed with the exact original placeholder week by moving the old mock `ScheduleView` events into a shared server/client module at [`lib/mock-calendar-events.ts`](./../lib/mock-calendar-events.ts).
- Updated [`app/api/dashboard/route.ts`](./../app/api/dashboard/route.ts) to return that full placeholder calendar template as the backend mock calendar source of truth, while still appending any future persisted non-calendar task/focus blocks.
- Switched [`app/page.tsx`](./../app/page.tsx) to load `ScheduleView` client-only and pinned [`components/dashboard/schedule-view.tsx`](./../components/dashboard/schedule-view.tsx) to the same placeholder week constants so the schedule header/calendar no longer relies on unstable SSR date state.
- Status: `/api/dashboard` now returns 25 placeholder calendar events covering the full April 6-10 mock week, and `/api/schedule` accepts those events as hard constraints successfully.
- Next step: if Eric later persists real placeholder calendar rows or Google events into `schedule_events`, decide whether the dashboard route should keep overriding `source: "calendar"` rows or switch to DB-owned calendar data.

### 2026-04-11 21:54 CDT

- Fixed the live schedule/dashboard contract break by normalizing Supabase `timestamptz` values in [`lib/data/mappers.ts`](./../lib/data/mappers.ts) before Zod validation, which removed the `Invalid schedule preparation context` and `Invalid dashboard response payload` failures.
- Patched the frontend calendar wiring so backend events with a missing `calendarId` fall into a visible `calendar-main` bucket instead of being silently filtered out by the sidebar visibility logic.
- Verified against the running app routes: `/api/dashboard` now returns real event data again, and `/api/schedule` succeeds for both a single task and the full `taskIds: []` scheduling call.
- Status: the schedule UI should now load backend placeholder events and the Schedule action should advance into real planner execution instead of failing at context prep.
- Next step: if we want scheduled blocks to persist across refresh, Eric still needs to write planner output into `schedule_events` rather than keeping it client-overlay-only.

### 2026-04-11 21:38 CDT

- Wired the schedule UI to real backend dashboard events and `/api/schedule` under direct user instruction, even though the repo’s default ownership split normally leaves `app/page.tsx` and `components/**` to Cindy/Eric.
- Replaced the schedule panel’s dead mock action state with a real scheduling request lifecycle: the existing blue Schedule control now triggers `/api/schedule`, shows loading/error/success status, and overlays returned planned task blocks on top of the backend dashboard calendar feed until refresh.
- Added a visible `cal-tasks` sidebar calendar plus dynamic frontend fallback calendars for backend event ids so returned planner blocks and backend mock events can render without waiting for Google or DB persistence.
- Status: the frontend now reflects the backend dashboard calendar feed and immediately shows scheduled task blocks from the planner response in-session.
- Next step: coordinate with Eric if the planned events should be persisted to `schedule_events`, since refresh still drops the local scheduling overlay by design.

### 2026-04-11 21:01 CDT

- Implemented the David-owned planner logic in [`lib/ai/claude.ts`](./../lib/ai/claude.ts) around a strict five-day horizon (`today` through `+4` days), structured Claude tool output, and deterministic validation for overlaps, deadlines, and horizon bounds.
- Added per-user markdown memory loading from `data/user-memory/<userId>.md` inside the Claude layer, with missing/unreadable files treated as empty memory so scheduling does not fail when no file exists yet.
- Aligned planner-created task blocks to the temporary `cal-tasks` default calendar id when a task does not already carry its own `calendarId`.
- Status: David’s scope is now ready for Eric/Cindy to wire backend hard-event loading and the schedule UI onto real dashboard events without requiring planner contract changes.
- Next step: coordinate with Eric/Cindy on the route/UI side because repo instructions still prevent David from directly changing `app/api/**`, `lib/data/**`, or `components/**`.

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
