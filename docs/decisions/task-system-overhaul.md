# Task System Overhaul (2026-06-18)

Branch: `feat/task-surface-overhaul` (8 commits, not yet merged to `main`).
Builds on the dashboard coherence refactor ([dashboard-coherence-refactor.md](./dashboard-coherence-refactor.md)).

This is the durable record of how JARVIS tasks are **created, stored, surfaced, searched, and synced** after this overhaul. If you touch the task system, read this first.

---

## 1. How a task is created (4 families)

Every task is one row in the Supabase `tasks` table. There are 8 physical write sites that collapse into 4 logical families:

- **A — Source-candidate approve funnel** (`lib/sources/persistence.ts` `approveSourceCandidates` → `candidateToTaskInsert`). The single shared insert reached by: manual approve (`/api/sources/candidates/approve`), and via `insertAndAutoApproveSourceCandidates` by Gmail, iMessage, source paste/upload, and the two Canvas browser-extension endpoints. Dedupes at the candidate layer (`candidateKey` = kind|title|due|course) + a commitment dedupe gate. Auto-approves only task/deadline/event candidates with a `dueAt` and confidence ≥ 0.85.
- **B — Structured 1:1 mirrors** (write tasks directly, keyed by `(user_id, external_task_id)`): **Notion** (`mirrorOpenNotionPagesToTasks`, plain insert), **Apple Reminders** (`lib/apple-reminders/ingest.ts`, upsert), **CalDAV VTODOs** (`lib/caldav/todos.ts`, upsert). The external system is the source of truth; re-syncs preserve planner-owned fields and delete rows removed upstream.
- **C — Canvas REST refresh** (`lib/sources/canvas-refresh.ts`): self-approves its own candidate then directly inserts/updates the task. Tags `["canvas", plannableType, course]`. (Distinct from the Canvas *extension* endpoints, which go through Family A.)
- **D — Manual / local**: `POST /api/tasks`, onboarding bulk insert, assistant `create_task` tool. No dedupe.

**The planner never inserts tasks** — `lib/daily-plan.ts` / `lib/ai/claude.ts` only UPDATE `scheduled_for`/`status`/`plan_id` and insert `schedule_events`. **Imported event-kind candidates with a concrete time bypass `tasks`** and become `schedule_events` (`source="imported"`).

## 2. Storage + lifecycle

`tasks` columns of note (see `types/index.ts` `TaskRow`, `schemas/common.ts` `taskSchema`): `deadline` (null = undated, exempt from overdue/missed), `status`, `scheduled_for`, `is_immutable`, `calendar_id` (always `cal-tasks`), `tags`, `source_snapshot_id`/`source_candidate_id`, `plan_id`, `external_task_id` + `last_synced_from` (provenance), `inferred_deadline*` (W2).

`status` ∈ **todo / scheduled / completed / missed** (`unconfirmed` is a `schedule_events` status, NOT a task status). Status is written ONLY at: `lib/reconciliation.ts` (auto-miss `deadline < now-7d`; stale-scheduled → todo), `lib/daily-plan.ts` + `/api/schedule` (todo↔scheduled), `/api/tasks/[id]` PATCH (complete/reopen), `lib/sources/notion-refresh.ts` (Notion completion/mirror), `lib/assistant/secretary.ts` (log-activity), and the dashboard archive-restore. **Undated tasks are never auto-missed** — that's why inferred deadlines exist.

`last_synced_from`: `TaskSyncOrigin = local | caldav | apple_reminders | notion | gmail | canvas`. Set via `candidateToTaskInsert` (from candidate `payload.externalSource`) or the direct mirrors. **Must be allowlisted in `normalizeTaskSyncOrigin` (`lib/data/mappers.ts`)** — it coerces anything else to `local`. This was a real bug: `notion` was missing there, so Notion tasks grouped under "JARVIS". Migrations widen the `tasks_last_synced_from_check` constraint for each new value.

## 3. Notion two-way sync (the deep one)

Notion's "Tasks" DB is mirrored **1:1 by page id**, never content-deduped (two same-title rows stay two tasks; identity is the page id stored in `external_task_id`). `lib/sources/notion-refresh.ts`:

- **`queryNotionDatabase`** fully paginates the DB (open + completed rows; `page_size` 100, cap `MAX_NOTION_DATABASE_PAGES = 1000`) and returns `{ pages, complete }`. `complete` = cursor exhausted (not capped) — reconciliation depends on a complete pull so "absent from pull" reliably means "gone from Notion".
- **`mirrorOpenNotionPagesToTasks`** upserts each OPEN page → task (create if missing — this is how a lost row comes back; else refresh title/deadline/all_day/priority; never reopen a completed task). Ranged Due Dates use the **end** as the deadline.
- **`applyNotionCompletionSync`**: pages completed/archived in Notion → matching tasks `completed`; and (only when `complete`) Notion-linked OPEN tasks whose page is gone (deleted/archived) are **removed** (Notion is source of truth); completed pages are kept as history. Stale pending candidates pruned.
- **Write-back** (`lib/sources/notion-completion.ts`, hooked in `/api/tasks/[id]`): JARVIS → Notion on every task mutation. `syncNotionTaskCompletion` (PATCH status) flips the page's completion checkbox on complete/reopen; `syncNotionTaskFields` (PATCH title/deadline) pushes the title + Due Date; `archiveNotionPageForTask` (DELETE) archives (trashes) the page. All best-effort, audited in `change_logs` (`external.notion.{complete,reopen,update,archive,*_failed}`). No loop (read-side updates via admin client, not the route; edits/sync are idempotent and converge). The reverse direction (Notion → JARVIS) is handled by the mirror on the next sync, not live.

**Why this mattered**: a deleted Notion page (or one completed beyond the old 200-row cap) left its task orphaned as `missed` forever. The full pull + deleted-page reconciliation fixes both. The Notion integration had write capability all along.

History: this replaced an earlier candidate/approve approach for Notion (which content-deduped and lost distinct rows — confirmed via two real "AIGP Certification" pages). The legacy event-kind tasks were relocated to `schedule_events` (migration `relocate_legacy_event_tasks`).

## 4. Surfaces

- **Right rail** (`components/dashboard/task-manager.tsx`, `mode="all"`): the calm "what needs you now" sliver — actionable tasks (unscheduled or overdue) expanded, Scheduled + Completed collapsed, **missed excluded** (they live in the Needs-you Archive). Has its own search bar.
- **Dedicated task pane** (`components/dashboard/task-pane.tsx`): a full-height `RailSheet` opened from a "Tasks" button in the left rail. **Group by Source / Status / Tag** (default Source), **Sort by Due date / Priority / Name** (default Due; completed + missed always sink below active work so missed never fronts a group), a token search, and ALL tasks including missed (with a Restore control). Group headers carry icons in source-channel signal hues (Notion blue, Canvas teal, Gmail copper, Apple green) / semantic status colors. Rows are **horizontal**: title left, status/deadline/course pinned right (`TaskRow titleAside`).
- **Shared building blocks** (extracted to avoid drift): `components/dashboard/task-row.tsx` (`TaskRow`, `TaskCheckbox`) and `lib/task-display.ts` (`NOISE_TAGS`, `isTaskOverdue`, `formatDeadlineShort`, `compareByDeadline`).
- **Header stat row** (`app/dashboard/page.tsx`): "TASKS" = total tasks (all statuses); "LOOSE" = unscheduled. Distinct from the rail's "Tasks N" count (= actionable only).

## 5. Search (`lib/task-search.ts`, tested)

Token-based ranked search, pure + per-keystroke. Fields tokenized on whitespace AND separators (`_ - / . , & () :`) so course codes like `2026SP_IEMS_225` are searchable by part. Per query term, strongest tier wins: exact > prefix (either direction, so `entrep` ↔ `entrep225` ↔ `entrepreneurship`) > shared-prefix(≥4) > substring(term≥4) > **anchored** fuzzy (subsequence sharing a token's first char — this anchor is what stops `mlm` matching random prose). Field weights title > tags(course) > description. Replaced a naive substring+loose-subsequence matcher that both over-matched ("MLM" → unrelated prose) and under-matched ("entrepreneurship" → nothing).

## 6. Source provenance & grouping

The pane's "by source" view groups on `last_synced_from`, mapped to labels in `taskSourceLabel` (notion/gmail/canvas/apple_reminders/caldav, else "JARVIS"). Gmail/Canvas are stamped at their import sites (gmail-refresh; the two Canvas extension endpoints via a new `insertAndAutoApprove` `externalSource` param; canvas-refresh direct insert). Paste/upload/manual remain "JARVIS" by design. **iMessage is not yet a distinct source** (1 task → JARVIS); same pattern if wanted.

## 7. Migrations applied to prod (`xerjtmrudhsuwcswpgoa`)

- `20260617200000_relocate_legacy_event_tasks` — moved legacy event-kind tasks → imported `schedule_events`.
- `20260618000000_allow_notion_task_sync_origin` — `tasks_last_synced_from_check` += `notion`.
- `20260618120000_allow_gmail_canvas_task_sync_origin` — += `gmail`, `canvas`.

One-time data ops run during the session: cleared 62 stale `source-review` tags; backfilled `external_task_id` on 12 Notion tasks; dismissed 95 stale Notion candidates; backfilled `last_synced_from` for 4 Canvas + 1 Gmail tasks.

## 8. Known / pending

- **Existing orphaned `missed` tasks** (deleted/old Notion pages) reconcile on the **next Notion sync** (Build Today / daily cron). The one-time reconcile was deliberately NOT force-run — it DELETEs prod rows; it needs an explicit go-ahead or runs on the user's next replan.
- The deleted-page reconciliation **deletes** open orphans (guarded by a complete pull). Completed tasks are kept.
- The prod source-refresh cron has historically been unreliable; the in-build (`buildDailyPlan`) trigger is the dependable path.
- `schemas/tasks.ts` and `lib/ai/claude.ts` are backend-owned (do-not-modify); the task-mutation response `externalWrite` is Canvas-shaped, so Notion write-back is a side effect, not surfaced there.
