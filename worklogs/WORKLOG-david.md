# David Worklog

## Log

### 2026-04-12 02:49 CDT

- Fixed the secretary’s event-inspection bug in [`lib/assistant/secretary.ts`](./../lib/assistant/secretary.ts): `list_events` was handing Claude raw UTC timestamps, so noon events were being reasoned about as 5–7 PM instead of local Chicago time.
- Updated the tool payload to include local event date/time labels, switched range filtering to overlap semantics instead of start-time-only matching, and taught the system prompt to treat the local event fields as authoritative for reasoning and replies.
- Verified against the live local app on `localhost:3000` with a non-mutating prompt (`What events do I have from 12pm to 2pm on Monday?`): the secretary now correctly reports `Debug software` at 12–1 PM and `Test event` at 1–2 PM.
- Status: full `pnpm exec tsc --noEmit` passes after the `list_events` local-time fix.
- Next step: optional cleanup only — there is a real duplicate `Debug software` row in `schedule_events`, so if that is unintended we should remove or merge it in a separate pass rather than hiding it in assistant output.

### 2026-04-12 02:44 CDT

- Found the deeper root cause for missing assistant-created calendar events: the rows were being persisted, but the assistant was inventing the wrong absolute year/month for relative requests because the `/api/assistant/message` route ignored the client-provided `now`/`timezone`, and the tool layer trusted those drifted absolute dates.
- Updated [`app/api/assistant/message/route.ts`](./../app/api/assistant/message/route.ts), [`lib/assistant/date-utils.ts`](./../lib/assistant/date-utils.ts), and [`lib/assistant/secretary.ts`](./../lib/assistant/secretary.ts) so the secretary now uses the real request timestamp/timezone, anchors relative phrases like `Monday` or `tomorrow` to that moment, and server-corrects model-drifted event dates from the original user request before writing `schedule_events`.
- Verified the fix end-to-end against the live local app on `localhost:3000`: a smoke-test event created through `/api/assistant/message` was stored at `2026-04-13 12:00 PM CDT` in `cal-tasks`, then immediately cleaned back out.
- Repaired the two already-broken rows created by the prior bad build: `Debug software` and `Test event` now both live on Monday, April 13, 2026 in `cal-tasks`, so the dashboard payload matches the intended week view again.
- Status: `pnpm exec tsc --noEmit` passes after the time-anchoring fix and bad-row repair.
- Next step: refresh the open dashboard session once so the current browser tab pulls the corrected event rows from `/api/dashboard`.

### 2026-04-12 02:29 CDT

- Traced the secretary persistence path and confirmed assistant-created work is split between the `tasks` table and `schedule_events`: plain tasks are written to `tasks`, while visible calendar blocks come from `schedule_events`.
- Added a shared calendar config in [`lib/calendar-config.ts`](./../lib/calendar-config.ts) and rewired [`components/dashboard/calendars-sidebar.tsx`](./../components/dashboard/calendars-sidebar.tsx), [`app/page.tsx`](./../app/page.tsx), and [`lib/assistant/secretary.ts`](./../lib/assistant/secretary.ts) to use the same `Tasks` calendar source of truth instead of drifting hardcoded IDs/names.
- Updated the secretary tool layer so assistant-managed task/event writes now target the required `Tasks` calendar, scheduled task blocks persist into `schedule_events` under that calendar, and missing `Tasks`/`Task` calendar configuration now throws an explicit backend error instead of silently succeeding.
- Status: `pnpm exec tsc --noEmit` passes after the Tasks-calendar refactor.
- Next step: browser-test one create-task flow and one create-event flow to confirm the created calendar items render under the visible `Tasks` calendar in the schedule view.

### 2026-04-12 02:18 CDT

- Upgraded the secretary/chat UX in [`components/dashboard/master-input.tsx`](./../components/dashboard/master-input.tsx) to render markdown replies, show a visible thinking state, auto-scroll to the newest turn on submit/response, and include recent transcript history in assistant requests so follow-up turns like `Title should be ...` keep context.
- Switched the desktop shell in [`app/page.tsx`](./../app/page.tsx) to a persisted draggable left sidebar using the existing resizable-panels primitive, then bumped the Anthropic defaults in [`lib/assistant/secretary.ts`](./../lib/assistant/secretary.ts) and [`lib/ai/claude.ts`](./../lib/ai/claude.ts) to `claude-sonnet-4-6`.
- Extended [`lib/mock-calendar-events.ts`](./../lib/mock-calendar-events.ts) to duplicate the placeholder week forward by seven days and moved the initial selected schedule date to Sunday, April 12, 2026 so the UI opens with both the previous and next mock weeks nearby.
- Status: full `pnpm exec tsc --noEmit` passes after this round, including the newly added markdown/resizable-panel dependencies.
- Next step: browser-test the follow-up secretary flow that previously created a task instead of the requested event, and verify the draggable left-panel width persists after refresh.

### 2026-04-12 02:00 CDT

- Confirmed the disappearing calendar was diagnostic, not incidental: `/api/dashboard` and the new assistant routes were both failing through the same demo-user bootstrap path, which is why the secretary error and full dashboard 500 showed up together.
- Removed the old parser-only assistant stack (`lib/ai/claude-parser.ts`, `lib/ai/parser-schema.ts`, and `lib/assistant/handleParsedInput.ts`) so the repo now has one live assistant path instead of a stale parser bridge sitting next to the secretary executor.
- Status: focused search shows no remaining source references to the deleted parser bridge, and the current assistant/dashboard/scheduler surface type-checks clean in the targeted pass.
- Next step: keep all follow-on assistant fixes inside the secretary/context route path and avoid reviving the older parser bridge unless there is a deliberate product reason to restore it.

### 2026-04-12 01:58 CDT

- Fixed the deeper Supabase bootstrap mismatch in [`lib/supabase/demo-user.ts`](./../lib/supabase/demo-user.ts): this environment’s `public.users.id` is constrained against `auth.users.id`, so creating a random public UUID was still invalid.
- Updated the helper to find or create the demo auth user through the admin API first, then insert the matching row into `public.users` using that auth user id; this should unblock both `/api/dashboard` and the new assistant/context routes.
- Status: focused TypeScript verification for `lib/supabase/demo-user.ts`, `/api/dashboard`, and the assistant routes is clean.
- Next step: refresh the app and retry both the dashboard bootstrap and a secretary prompt; any remaining 500 should now be a downstream route/tool issue instead of demo-user identity setup.

### 2026-04-12 01:55 CDT

- Fixed the secretary bootstrap regression in [`lib/supabase/demo-user.ts`](./../lib/supabase/demo-user.ts) after the new assistant routes surfaced a `null value in column "id" of relation "users"` failure on first interaction.
- Replaced the old demo-user upsert path with an explicit fetch-first / insert-with-`crypto.randomUUID()` flow so assistant/context routes no longer depend on the live database having a working `users.id` default.
- Status: focused TypeScript verification for the demo-user helper plus assistant routes is clean; the secretary should now get past demo-user creation and return a real reply instead of the red bootstrap error.
- Next step: retry the master-input conversation in the browser and, if needed, inspect any follow-on Anthropic or tool-execution errors after the user bootstrap is no longer the first blocker.

### 2026-04-12 01:34 CDT

- Implemented the first secretary-style master-input pass across [`app/api/assistant/message/route.ts`](./../app/api/assistant/message/route.ts), [`app/api/assistant/context/route.ts`](./../app/api/assistant/context/route.ts), and [`lib/assistant/secretary.ts`](./../lib/assistant/secretary.ts), replacing the parser-only response with a Claude tool-execution loop plus inspectable availability/memory context.
- Rebuilt [`components/dashboard/master-input.tsx`](./../components/dashboard/master-input.tsx) into a console with a transcript, inline tool receipts, and accordion drawers for availability, memory, and exposed secretary actions, then moved it to the top-left of [`app/page.tsx`](./../app/page.tsx) while making the right column collapsed by default.
- Softened scheduler availability enforcement in [`lib/ai/claude.ts`](./../lib/ai/claude.ts) so preferred windows stay visible and promptable but no longer hard-fail placements outside those windows.
- Status: targeted TypeScript grep for the touched secretary/layout/scheduler files is clean, but repo-wide `pnpm exec tsc --noEmit` still fails on pre-existing issues in `components/dashboard/task-sidebar.tsx` and `lib/stores/calendar-store.ts`.
- Next step: live-test the secretary flow with a real Anthropic key and decide whether placeholder calendar events should become fully editable instead of returning the current explicit read-only clarification.

### 2026-04-12 00:22 CDT

- Fast-forwarded local `david-scheduling-logic` from `3104291` to `31cb075` so the branch now matches `main`'s integrated state with Eric's backend parser/input merge on top of David's earlier scheduling work.
- Pulled in the new assistant parsing/backend action flow plus shared `allDay` task/event contract updates that now affect the planner boundary in [`lib/ai/claude.ts`](./../lib/ai/claude.ts).
- Status: local branch sync completed cleanly with `git merge --ff-only main`; local branch is now ahead of `origin/david-scheduling-logic` until pushed.
- Next step: push `david-scheduling-logic` if this synced branch should become the new remote baseline for David's work.

### 2026-04-12 01:02 CDT

- Reworked [`lib/ai/claude.ts`](./../lib/ai/claude.ts) to stop loading per-user filesystem markdown and instead generate a scheduler memory summary from planner-visible structured preferences, with an exported summary builder intended for reuse by the incoming master-prompt flow.
- Added dev-only scheduler introspection in the Claude layer so local runs can inspect the exact model, system prompt, rendered memory summary, availability windows, fixed events, schedulable tasks, and final prompt payload sent to Claude.
- Re-hardened the tasks-calendar rule in the planner: both fixed task events and newly planned task blocks now force `calendarId: "cal-tasks"` instead of inheriting arbitrary task calendar ids.
- Status: planner-side memory prompting and debug visibility are updated; broader onboarding / DB-memory-log wiring is still blocked by repo ownership rules because David cannot modify `app/api/**`, `schemas/**`, `types/**`, `lib/data/**`, or UI files from this lane.
- Next step: coordinate with Eric/Cindy so the shared DB-backed memory summary builder in `claude.ts` can be fed real `memory_logs` and onboarding answers from backend/UI-owned flows.

### 2026-04-11 22:58 CDT

- Wired the dashboard bootstrap contract to return real `tasks` alongside `events`, then added DB-backed task CRUD routes at [`app/api/tasks/route.ts`](./../app/api/tasks/route.ts) and [`app/api/tasks/[id]/route.ts`](./../app/api/tasks/[id]/route.ts) so the UI can create, edit, complete, and delete real tasks instead of local mocks.
- Replaced the local task panel state in [`app/page.tsx`](./../app/page.tsx) and [`components/dashboard/task-manager.tsx`](./../components/dashboard/task-manager.tsx) with one shared DB-backed task source, making the left `Tasks` tab and right task panel stay in sync while grouping tasks into overdue, unscheduled, scheduled, and collapsed completed sections.
- Forced planner-created task blocks in [`lib/ai/claude.ts`](./../lib/ai/claude.ts) to always emit `calendarId: "cal-tasks"` so scheduled work now renders under the single Tasks calendar instead of inheriting category calendars.
- Status: live verification passed for dashboard task bootstrap, task create/update/delete, and a targeted `/api/schedule` call returning a `source: "task"` event in `cal-tasks`; repo-wide TypeScript still has unrelated pre-existing errors in `components/dashboard/task-sidebar.tsx` and `lib/stores/calendar-store.ts`.
- Next step: if Cindy wants richer task editing polish, build on the new shared task state instead of reintroducing separate local task models.

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
