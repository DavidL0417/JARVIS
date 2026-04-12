# Eric Worklog

## Log

### 2026-04-12 01:06 CDT

- Fixed a timezone parsing bug for date-only task input: the assistant write layer was letting JavaScript directly parse strings like `April 20`, which produced a midnight timestamp and shifted some tasks into the previous local day.
- `resolveNaturalDateTime()` now only trusts direct parsing for already-precise timestamp strings; natural-language dates now always flow through the explicit local-date resolver before being stored.
- Status: `pnpm exec tsc --noEmit` passes and date-only tasks should now land on the intended day instead of showing up around 6 PM the day before.
- Next step: retry `Do homework on April 20` and confirm the newest task row has an end-of-day deadline on April 20 local time and renders on the correct day in the calendar.

### 2026-04-12 00:58 CDT

- Simplified task semantics so tasks no longer use all-day mode at all; date-only task input now normalizes to a standard end-of-day deadline instead of `all_day = true`.
- Updated the assistant write layer to always store tasks with `all_day = false`, and updated calendar task rendering so deadline-only tasks display as timed blocks ending at the deadline rather than in the all-day lane.
- Status: `pnpm exec tsc --noEmit` passes and old task `all_day` flags are ignored by the calendar renderer.
- Next step: retry a prompt like `Do homework on April 21st` and confirm the new task row has a populated end-of-day deadline and appears near the end of that day in the calendar.

### 2026-04-12 00:43 CDT

- Fixed a parser-to-DB gap for all-day tasks: if Claude leaves `task.due_at` blank, the parser now backfills the temporal phrase from the raw message before the assistant write layer resolves the deadline.
- This was the root cause behind all-day task rows being inserted with `deadline = NULL` even when the UI summary clearly said something like `on April 20`.
- Status: `pnpm exec tsc --noEmit` passes and date-only task prompts should now persist a real end-of-day deadline instead of a null deadline.
- Next step: retry `Do homework on April 20` and confirm the new task row has a populated deadline and appears in the correct all-day lane.

### 2026-04-12 00:34 CDT

- Split all-day semantics so assistant-created all-day tasks now store an end-of-day deadline, while all-day events store a true full-day range from local 00:00 to next-day 00:00.
- Updated `ScheduleView` task mapping so all-day tasks anchor to the start of their local calendar day instead of using the deadline timestamp as the visible start.
- Status: `pnpm exec tsc --noEmit` passes and the all-day task/event model is now explicit instead of sharing one ambiguous helper.
- Next step: retry a date-only task like `On Monday April 20 I need to do homework` and a date-only event to confirm both land on the intended day in the calendar UI.

### 2026-04-12 00:28 CDT

- Added a shared backend Tasks-calendar policy in `lib/tasks-calendar.ts` and updated scheduler memory loading so Claude now always sees “all tasks are stored in the Tasks calendar (`cal-tasks`).”
- Enforced `cal-tasks` across task creation/update paths in `/api/tasks`, assistant-created tasks, onboarding task inserts, and the page’s optimistic task state so task calendar assignment no longer drifts.
- Status: `pnpm exec tsc --noEmit` passes and the Tasks calendar rule is now true in both persisted data and scheduling memory.
- Next step: optionally remove or lock the task calendar selector in the frontend task form so the UI no longer suggests tasks can live on other calendars.

### 2026-04-12 00:11 CDT

- Hardened the scheduler Claude tool parsing so a missing `summary` field no longer crashes the whole `/api/schedule` flow after the tool payload comes back.
- Relaxed the tool schema requirement for `summary` and added a backend fallback summary synthesizer based on placements/unscheduled counts.
- Status: `pnpm exec tsc --noEmit` passes and the prior `summary is required` planner error should no longer block the Schedule button.
- Next step: retry scheduling in the browser; if it still fails, the next issue should be a real placement/planning constraint rather than missing tool metadata.

### 2026-04-12 00:04 CDT

- Fixed the merged scheduler request contract so `app/page.tsx` now includes `allDay` when posting `hardEvents` to `/api/schedule`.
- Made `scheduleEventInputSchema` tolerate omitted `allDay` values with a safe default to avoid brittle 400s from older callers.
- Status: `pnpm exec tsc --noEmit` passes and the `Invalid schedule request` failure should no longer occur from the missing `allDay` field alone.
- Next step: retry the Schedule button in the browser and confirm any remaining failure is inside planner logic rather than request validation.

### 2026-04-11 23:58 CDT

- Resolved the pull/rebase conflict set across `app/page.tsx`, `components/dashboard/task-manager.tsx`, `lib/ai/claude.ts`, and dashboard schema/contracts after David’s scheduler/task CRUD changes landed on top of the newer dashboard/all-day/calendar-task wiring.
- Kept David’s raw `Task[]` state + task CRUD flow, preserved the dashboard refresh/all-day/calendar task display behavior, and cleaned duplicate `tasks` keys in the shared dashboard type/schema/route payloads.
- Aligned task CRUD with the current shared task contract by threading `allDay` through task request schemas and task route selects/inserts.
- Status: merge markers are gone repo-wide and `pnpm exec tsc --noEmit` passes again.
- Next step: runtime-test task creation/editing/scheduling in the browser now that the merged page is compiling with both the scheduler and the DB-backed calendar/task flow intact.

### 2026-04-11 23:18 CDT

- Changed the assistant parser default so date-only task/event requests now assume all-day instead of treating the missing time as a clarification blocker.
- Updated the Claude parser prompt examples and normalization logic so requests like `shopping with Cindy on April 12` or `finish CS213 homework on April 16` map to `all_day: true` automatically when no time cue is present.
- Status: `pnpm exec tsc --noEmit` passes with the new default-all-day behavior in place.
- Next step: live-test a few date-only requests end to end now that the parser and DB bridge agree on all-day fallback semantics.

### 2026-04-11 23:09 CDT

- Promoted all-day semantics into real persisted schema fields by adding `all_day` to the canonical `tasks` and `schedule_events` SQL definitions, then threading that field through shared TS/Zod contracts, mappers, dashboard/schedule reads, onboarding task input, and assistant DB writes.
- Status: the codebase now expects `public.tasks.all_day` and `public.schedule_events.all_day` to exist, and `pnpm exec tsc --noEmit` passes with the updated schema contract.
- Next step: apply the new `all_day` columns in Supabase before testing all-day writes or dashboard reads against a live database.

### 2026-04-11 23:05 CDT

- Added first-pass all-day parsing support for both tasks and events in the assistant pipeline by extending the parser contract with `task.all_day` / `event.all_day` and teaching Claude explicit all-day examples.
- Updated the DB action bridge to map all-day events into full-day `schedule_events` ranges and all-day tasks into end-of-day task deadlines without requiring a Supabase schema change.
- Status: `all day` phrasing now compiles cleanly through parser validation and DB-write handling using the existing timestamp columns.
- Next step: if we want to preserve all-day semantics explicitly in the database/UI long-term, add real `all_day` columns later instead of only inferring them from stored timestamps.

### 2026-04-11 22:17 CDT

- Extended `/api/dashboard` to return real task rows alongside events, and stopped blanket-filtering persisted `source: "calendar"` events so assistant-created fixed events can come back through the dashboard payload.
- Wired `app/page.tsx` to map dashboard tasks into the existing `TaskManager` shape, hydrate missing calendars from DB task/event calendar IDs, and listen for a lightweight `jarvis-dashboard-refresh` event after successful assistant submissions.
- Status: DB-backed tasks now feed the task panel state instead of `initialTasks`, DB-backed events still feed `ScheduleView`, and successful Master Input writes now trigger a dashboard refetch so new rows can appear back in the UI.
- Next step: persist task-manager add/toggle/delete actions to Supabase too, since that component still edits local state after the initial DB hydration.

### 2026-04-11 21:49 CDT

- Fixed a dashboard 500 caused by Zod rejecting real Supabase `timestamptz` strings with offsets (for example `+00:00`) after assistant-created schedule events started showing up in `schedule_events`.
- Updated the shared task/event datetime schemas to accept offset-bearing timestamps so `/api/dashboard` can validate real DB rows instead of only strict UTC-style strings.
- Status: TypeScript passes again; dashboard payload validation should no longer break just because real scheduled events exist in Supabase.
- Next step: restart the dev server if the stale Turbopack overlay persists, then verify `/api/dashboard` returns 200 with the newly inserted events.

### 2026-04-11 21:47 CDT

- Added a backend-owned current-day helper in `lib/time/current-day.ts` so assistant parsing now has a server-derived local date context instead of relying only on the raw frontend timestamp.
- Wired `/api/assistant/message` to compute `nowIso`, `timezone`, and `currentDay` on the backend before calling Claude, and updated the parser prompt to explicitly include the current local day for relative-time interpretation.
- Status: parser requests now carry a normalized backend current-day context (`YYYY-MM-DD`) into Claude for `today` / `tomorrow` / weekday resolution.
- Next step: if date handling still feels inconsistent, reuse the same helper inside scheduling/planning code so parser and scheduler share one backend time-context model.

### 2026-04-11 21:43 CDT

- Fixed an assistant-input DB write edge case where event requests using ordinal dates like `April 12th at 6 pm` parsed successfully but did not persist because the backend date resolver only matched bare month-day phrases like `April 12`.
- Status: `create_fixed_event` writes now recognize `st`/`nd`/`rd`/`th` suffixes during schedule-event timestamp resolution.
- Next step: surface `actionsTaken` in the Master Input UI so parser success and DB-write success are easier to distinguish during testing.

### 2026-04-11 21:36 CDT

- Integrated the direct-input parser route with a backend action bridge so validated assistant intents now write to Supabase tasks, schedule events, preferences, and memory logs through `lib/assistant/handleParsedInput.ts`.
- Wired `/api/assistant/message` to resolve the MVP demo user, apply DB actions, and return `actionsTaken` alongside the parsed payload without mixing in scheduling logic.
- Adjusted parser behavior so flexible timeboxed blocks can stay `create_fixed_event` with `event.is_immutable = false`, which lets the new handler distinguish soft events from hard commitments.
- Status: `pnpm exec tsc --noEmit` passes and `pnpm build` passes after rerunning outside the sandbox so Next could fetch Google Fonts.
- Next step: pull David’s backend push, compare any assistant/scheduling contract overlap, and then decide which parsed actions should create draft records versus requiring follow-up clarification in the UI.

### 2026-04-11 21:05 CDT

- Hardened the direct-input Claude parser against brittle fallbacks by loosening parser output date fields from strict ISO datetimes to structured strings, adding few-shot event/task examples, and introducing safer JSON extraction plus light normalization before final Zod validation.
- Added development-only parser diagnostics (`validated` vs `fallback` plus error codes) in the route/UI and server-side debug logs for raw Claude text, extracted JSON, and schema issues without exposing secrets.
- Status: obvious event-style requests like shopping/dinner/appointments now have a much stronger best-fit path toward `create_fixed_event` instead of collapsing straight to `unknown`.
- Next step: test a few live phrases against the real Anthropic key and tune any remaining edge cases based on the new debug metadata rather than blind fallback behavior.

### 2026-04-11 19:17 CDT

- Added the first-pass Claude parsing layer for direct dashboard input with a thin `/api/assistant/message` route, shared Zod parser contracts, and a Claude Sonnet 4.6 helper that returns validated structured intent JSON.
- Swapped `MasterInput` from local heuristics to a real backend POST while keeping the UI local-only; no scheduling, DB mutation, or Google Calendar behavior was added in this pass.
- Status: `pnpm exec tsc --noEmit` passes and `pnpm build` passes after allowing external Google Fonts fetch during the build check.
- Next step: set `ANTHROPIC_API_KEY` in local/Vercel, then start consuming the parsed intent object for task/event/memory flows without letting Claude mutate state directly.

### 2026-04-11 18:10 CDT

- Reconciled backend/shared task, schedule event, preferences, and check-in contracts so raw Supabase rows are now explicitly snake_case and app-facing models are explicitly camelCase through centralized mapper functions.
- Added persisted `tasks.tags` support end-to-end in `sql/schema.sql`, shared TS/Zod contracts, onboarding inserts, dashboard/task reads, and schedule preparation reads.
- Status: `pnpm exec tsc --noEmit` passes and `pnpm build` passes after rerunning with network access for Google Fonts.
- Next step: apply the `public.tasks.tags` schema change in Supabase so existing environments match the updated canonical task model.

### 2026-04-11 17:32 CDT

- Added the provided Google OAuth client ID and client secret to local `.env.local`.
- Status: Google client credentials now exist locally, but `GOOGLE_REDIRECT_URI` is still unset and the repo does not yet expose a Google OAuth callback route.
- Next step: add the exact redirect URI from the Google Cloud OAuth client and implement the callback/auth flow before expecting Google sign-in or Calendar consent to work.

### 2026-04-11 17:28 CDT

- Added `is_immutable` and `calendar_id` across the backend scheduling data model for both tasks and schedule events, including SQL schema, shared TS/Zod contracts, DB row mappers, and route read/write points.
- Status: onboarding now persists the new task fields, dashboard/schedule reads now return them, and the scheduler stub preserves them in typed planner context without requiring frontend changes.
- Next step: when David wires real planner logic, make it actively respect `is_immutable` for move/protect decisions and use `calendar_id` when calendar sync is implemented.

### 2026-04-11 16:17 CDT

- Completed the merge-readiness cleanup pass: removed generated build noise from the diff, confirmed `.env.local` stays gitignored, and added README setup notes for env copying plus Supabase schema application.
- Status: branch is now positioned as a backend foundation milestone with intentional docs/setup guidance, explicit demo-user behavior, and an intentionally stubbed `/api/schedule` path.
- Next step: manually apply `sql/schema.sql`, set env vars in local/Vercel, and then decide when to replace the demo-user pattern and schedule stub with full production behavior.

### 2026-04-11 15:36 CDT

- Added the first real backend milestone: MVP Supabase SQL schema in `sql/schema.sql`, demo-user bootstrap helper, DB row mappers, and DB-backed `dashboard`, `onboarding`, and `schedule` route flows.
- Status: `/api/dashboard` now reads live Supabase tables, `/api/onboarding` creates or reuses the MVP demo user and writes preferences/tasks, and `/api/schedule` now reads DB context and returns a validated planner stub for David’s future Claude hookup.
- Next step: apply `sql/schema.sql` in Supabase, set the required env vars, and then wire the validated schedule output into real DB writes plus the remaining `checkin` and `replan` persistence.

### 2026-04-11 15:12 CDT

- Applied backend ownership markers across `app/api/**`, `lib/**`, `schemas/**`, and `types/**`, plus a narrow marked data-fetching section inside `app/page.tsx`.
- Status: backend protection comments now make the shared boundary explicit without changing UI structure or dashboard component code.
- Next step: keep any new backend logic inside marked sections/files so frontend work can continue safely in `components/**` and the UI portions of `app/page.tsx`.

### 2026-04-11 15:00 CDT

- Extracted dashboard fetch responsibility out of `app/page.tsx` into backend-owned `lib/data/dashboard.ts` to reduce shared merge pressure with frontend/UI work.
- Status: `app/page.tsx` is now a thinner shared rendering layer that imports `getDashboardData()` and only manages page-local UI state plus prop passing.
- Next step: keep future dashboard data changes in `lib/data/**` so teammate UI edits in `app/page.tsx` stay low-conflict.

### 2026-04-11 14:56 CDT

- Finalized Eric handoff note for the JARVIS backend foundation pass in the canonical worklog.
- Status: backend API scaffolding, shared schemas/types, service stubs, dependency updates, and minimal dashboard wiring are all recorded here for the next session.
- Next step: begin replacing mock dashboard and placeholder route responses with persisted Supabase-backed data flow.

### 2026-04-11 14:52 CDT

- Built JARVIS backend foundation with typed App Router endpoints in `app/api/*`, shared Zod schemas in `schemas/*`, and shared domain types in `types/index.ts`.
- Added future-facing service stubs for Supabase, Claude, and Google Calendar plus `.env.example` and the required SDK dependencies in `package.json`.
- Kept the existing dashboard UI intact and minimally wired `app/page.tsx` to fetch `/api/dashboard`, feeding live data into `WorkspaceSnapshot`, `WhatToDoNow`, and `StatusPanel`.
- Status: `pnpm exec tsc --noEmit` passes and `pnpm build` passes after allowing external font fetch during the build check.
- Next step: replace mocked dashboard data and placeholder POST success responses with real Supabase persistence, AI scheduling, and calendar sync.

### 2026-04-11 00:00 America/Chicago

- Started contributor-specific worklog structure for Eric.
- Current focus: mostly backend work unless redirected.
- Status: initial log created as the canonical handoff file for Eric.
- Next step: append new entries here when Eric begins or completes meaningful work.
