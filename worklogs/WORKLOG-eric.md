# Eric Worklog

## Log

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
