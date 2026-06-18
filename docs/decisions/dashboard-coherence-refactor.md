# Dashboard Coherence Refactor

Status: **in progress** — kicked off 2026-06-17. The high-level structure below was agreed
before touching components, per the working principle of leading with intent and not
working piecemeal.

## Implementation status

- **Workstream 1 — the "Needs you" rail: shipped.** New `risk_decisions` table
  (`(user_id, risk_type, subject_key)`, `dismissed_until` / `archived_at`); `deriveRiskItems`
  now tags each risk with a stable `riskType` + `subjectKey`; a read-time overlay
  (`lib/needs-you.ts`) applies snooze/dismiss and drops risks whose task was completed or
  aged out, so "Mark done"/dismiss/snooze take effect on the next load without a replan; the
  7-day auto-timeout → `missed` sweep lives in `reconcileStaleSchedule`; action-first cards
  (`components/dashboard/needs-you-panel.tsx`) fold in the re-entry recap; the reversible
  Archive drawer is the union of `missed` tasks + dismissed decisions (no new store beyond
  the decision table). Primary "fix" actions reuse the replan endpoint; decisions hit a new
  `POST/DELETE /api/risks/decisions`. The standalone `ReentryRecap` and the Risk Radar
  section of `ContextRailPanel` are removed. **Deferred within W1:** the morning-beat daily
  digest cron (the consolidated surface exists; the scheduled push does not).
- **Workstream 2 — undated tasks / inferred deadlines:** not started.
- **Workstream 3 — TaskManager routing, AutoImportDigest deletion, Plan Basis relocation:**
  not started. Plan Basis still renders in the rail (collapsed/relocated here), and
  AutoImportDigest is still present, pending W3.

## Goal

A top-to-bottom coherence pass on the dashboard — the product's first screen, not a
landing page. Every element must earn its place: cut anything decorative, vestigial, or
unexplained. Define the overarching structure first, then the components.

## Frame: the left answers, the right justifies

- **Left** — the plan. Now/next command strip plus the schedule grid. Answers *what to
  do, and when*. This is coherent today and stays the dominant surface (schedule-first).
- **Right** — the rail. Should answer one question: *what needs me, and why*. Today it
  overloads the operator: provenance (Plan Basis), inert risks (Risk Radar), recent
  imports, and the full task list all render at equal weight with no priority among them.

## Workstream 1 — the "Needs you" rail

The first concrete slice of the pass. Reduces overload and gives the operator control.

### Problems

- **Plan Basis competes with decisions.** It is provenance — receipts for the plan — yet
  it sits at full weight at the top of the rail. The operator only needs it when a source
  is wrong. (`components/dashboard/context-rail-panel.tsx`)
- **Risk Radar lists problems with no action and no expiry.** Each risk is inert text;
  the operator reads a problem but cannot act on it. Worse, nothing ages out — the
  "Overdue work" rule fires for any non-completed task past its deadline with no lower
  bound on age, so stale items pile up indefinitely. (`lib/daily-plan.ts` `deriveRiskItems`)

### Changes

1. **Plan Basis → collapsed and out of the way.** Today it sits at full weight at the top
   of the rail. Collapse it to a quiet, on-demand disclosure ("Plan basis · N sources ·
   built Xm ago") — neutral when healthy, semantic color (amber/red) only when a source is
   stale or failed (which folds in the standalone "Source refresh failed" risk). Placement
   moves out of the rail entirely to a per-term dropdown above the calendar — see
   Workstream 3.

2. **Risk Radar → "Needs you", action-first.** Each item carries a primary action plus
   reversible secondaries. No item is ever just text:

   | Risk | Primary action | Secondary |
   | --- | --- | --- |
   | Overdue work | Reschedule | Mark done · Dismiss |
   | Deadline without block | Schedule it | Snooze |
   | Planner couldn't fit | Make room / replan | Mark unschedulable |
   | Overloaded day | Review that day | Dismiss |
   | Compression ahead | Spread work | Dismiss |
   | Source refresh failed | (moves to the Plan Basis chip — Retry sync) | — |

3. **Lifecycle — every risk resolves, snoozes, or ages out.**
   - Auto-timeout: an overdue item older than **7 days** auto-archives and flips the task
     to `missed`, which `deriveRiskItems` already suppresses. This is the safety net for
     risks the operator never engages with — it ends the pile-up.
   - Snooze: hides the item until the snooze expires, then it returns.
   - Dismiss: moves to the Archive (below), reversible. No silent destruction.

4. **Consolidate the attention surfaces.** Re-entry recap, Risk Radar, and a daily digest
   are the same idea — "things that need your attention." Merge into the single "Needs you"
   surface. A once-daily digest surfaces the top 1–3 actionable items, reusing the calm
   re-entry card pattern and the existing local sync cron
   (`com.jarvis.sync`). In-app digest first; push/email is a later, separate channel.

### Archive — one reversible home, no new store

"Long-overdue" and "dismissed" collapse into a single Archive the rail links to (a
lightweight drawer, not a new top-level surface — density without clutter). It is the
union of two things that already have homes, so we do not build a third data store
(the lesson from the memory-store consolidation):

- Auto-timed-out / long-overdue tasks are already `missed` tasks — the Archive shows a
  filtered view of the existing task list (`status = missed`). Un-archiving returns a
  task to `todo`.
- Dismissed risks are the small `(task_id, risk_type)` decision records from the
  Mechanism below. Un-dismissing lets the risk reappear.

### Mechanism

Risks stay derived and ephemeral — recomputed each plan rebuild, never stored. Persist
the operator's **decision** about a risk, not the risk itself: a small table keyed by
`(task_id, risk_type)` holding `dismissed_until` and `archived_at`. `deriveRiskItems`
filters out parked items; auto-timeout is a derive-time rule (or a status sweep that marks
stale tasks `missed`). Small, additive change — no new risk store.

### Principles honored

- **Tradeoffs over assertions** — each item still names the cost, now with a way to act on it.
- **Approval before destruction** — dismiss/archive are reversible; auto-timeout flips a
  task to `missed`, it does not delete.
- **Density is positive** — compact action cards, not padded panels.
- **Real data only** — empty "Needs you" is honestly empty.

## Workstream 2 — undated tasks and inferred deadlines

Separable from the rail tidy (Workstream 1 ships without it), but the answer to "what
happens to a task with no deadline."

- **Undated tasks never enter the overdue/missed lifecycle.** The overdue rule keys off
  `deadline < now`; a null deadline never matches. So they cannot pile up in the radar and
  the 7-day auto-timeout never touches them — the data model already handles that worry.
- **The real risk is the opposite — they go invisible.** Two cases: a genuine
  someday/soft-backlog task (low pressure, planner context), versus a task with an
  *implicit* deadline the operator never typed ("service car" before a two-month trip).
- **Explicit deadlines are authoritative — only infer into the gap.** Inference fires
  *only* for tasks with a null deadline. A deadline already set (user-typed, or imported
  from Notion/Gmail/Canvas) is never re-inferred or overwritten; on import, tasks that
  already carry a deadline skip inference entirely.
- **Infer a deadline, but propose it — never set it silently.** A silent write could be
  wrong and breaks "approval before destruction." Emit an **inferred-deadline suggestion**
  reusing the existing source-candidate → review → approve pattern. It becomes a new
  "Needs you" item type ("Suggested deadline · service car by [date], because you're away
  [dates]" → primary "Set deadline", secondary "Keep undated"), folding into the
  Workstream 1 rail rather than adding new UI.
- **Where the LLM runs.** Greenfield — there is no task-urgency inference today (source
  extraction uses Claude; tasks carry only a user-set priority). Do not classify every task
  on every render. Infer once at task creation/ingestion, and re-run on the daily pass
  against current calendar/memory context (the trip may be added later), caching the
  suggested by-when on the task. The rail and planner read the cached value.
- **Confidence — defensible, not speculative.** Surface a suggestion only when a concrete
  anchor makes the deadline logically follow (a dated trip, a dated event, an explicit
  dependency), and always present it with that reasoning. No anchor → stay silent. Cautious
  enough not to nag, eager enough to catch the forgotten-deadline case; never a guess.
- **Scope guard for v1:** infer a *suggested deadline* only. Treating inferred urgency as a
  soft planner weight for still-undated tasks is a follow-on, not v1.

### Deadlines review surface

The single rail nudge is right for the high-confidence, act-now case. But deadline work is
a workflow with its own lifecycle — **extract** (explicit, from sources), **infer**
(implicit, from context), **review/approve**, **edit** — currently scattered across the
source pipeline, the task manager, and nowhere (inference). A dedicated **Deadlines**
review surface gives that scattered concern one home and makes the inference legible and
auditable (what JARVIS inferred, and why), which is how it earns trust. Same pattern as the
existing Sources review surface, applied to the deadline domain.

Scope it deliberately — do not over-build:

- It is a *review/triage* surface (batch-approve suggestions, see undated tasks JARVIS is
  reasoning about, see each deadline's provenance: user-set / from source / inferred +
  reasoning). Not a deadline database, not a second schedule.
- Earn its place. Start as a view reachable from the rail's inferred-deadline items
  ("Review all →") and from the task manager — not a heavy top-level nav item. Promote to
  top-level only if real volume and use justify it.
- Keep the rail nudge for the single high-confidence case; the surface is the deliberate,
  batch counterpart. Two altitudes of the same workflow.
- **Sequence:** inference logic + a single rail nudge first; build the surface once there
  is real inferred output to triage. The inference is the substance; the screen manages it.

## Workstream 3 — TaskManager and import routing

The TaskManager (`components/dashboard/task-manager.tsx`) is the rail's biggest overload —
65 items — because it has **no presentation criteria**. It shows every non-`completed` task,
bucketed by status (Overdue / Todo / Scheduled), sorted by deadline. Type, source, age, and
relevance are ignored, so imported calendar events pile in alongside real work.

### Route by kind: tasks stay, events go to the calendar

The fix is upstream, in the import pipeline — and the signal already exists. Extraction
already classifies each item's **kind** (the `task` / `deadline` / `event` tags); the
pipeline ignores it and makes a task row for everything. Instead, route by kind:

- **`event`-kind → the calendar**, not the task list. Fixed-time commitments (recitals,
  juries, exam reminders, check-ins) belong on the schedule, not in a to-do list.
- **`task` / `deadline`-kind → the TaskManager**, as real schedulable work.
- Route by *nature, not source*: an imported item that is genuine work ("complete Week 1
  Basecamp assignment") stays a task. The kind tag already encodes this.

This alone drains most of the SCHEDULED group (the bulk of it is `event`-kind).

### Imported events are provisional but concrete

Auto-created events land on the calendar with a **yellow border + checkmark** = "JARVIS
identified this, confirm it." But they are **treated as concrete commitments for planning
immediately** — the planner blocks around them the moment they appear; the confirm only
catches the rare misfire, it is not a gate. Rationale: creation is high-confidence and
sparing (JARVIS is not spam-creating dozens of events), so an unconfirmed event is
near-certain to be real, and treating it as soft would risk double-booking around a genuine
commitment. Confirming clears the border → a normal trusted commitment. Reuses the existing
`is_checked_in` provisional/confirmed semantics; no new concept.

### Delete AutoImportDigest

AutoImportDigest (Panel 3) — the 24h "here's what I auto-added, undo it" list — is **removed
outright.** Its two jobs move in-place: a freshly imported item already wears its own
provisional marker (yellow border on an event; the same treatment on a new task) with
confirm/reject right there. A separate panel listing what was imported is redundant once
each item is self-describing. One fewer panel on the rail.

### Plan Basis relocates above the calendar

Beyond collapsing (Workstream 1), Plan Basis leaves the rail entirely: a disclosure
("dropdown") above the schedule, scoped **per term** — "the context and sources behind this
term's plan." It sits with the schedule it explains, on-demand, out of the attention rail.

### Right rail, after

From four panels to two:

- **Needs you** — the consolidated attention surface (Workstream 1: actionable risks +
  inferred-deadline suggestions + the daily digest).
- **TaskManager** — tasks only, no imported events, old overdue drained by the 7-day
  timeout. A manageable list.

Plan Basis moves above the calendar; ReentryRecap folds into "Needs you"; AutoImportDigest
is deleted.

### Implementation plan (2026-06-17)

Grounded in the code: there is **no import→calendar path today** (`candidateToTaskInsert`,
`lib/sources/persistence.ts`, turns event-kind candidates into tasks with `scheduled_for`
on `cal-tasks`), the **provisional yellow-border/checkmark UI does not exist** (`is_checked_in`
is in the data layer + APIs but `schedule-view.tsx` renders nothing from it), and there is
**no term model** anywhere. Resolved defaults: imported events attach to the existing
`cal-tasks` calendar tagged `source="imported"` (no calendar-provisioning subsystem in v1);
unconfirmed imported events block the planner immediately (confirm only catches misfires);
Plan Basis is scoped to the active plan/horizon, not "per term."

- **Slice A — route by kind (backbone).** Migration: add `approved_event_id` to
  `source_candidates`; add `'imported'` to the `schedule_events.source` check constraint so
  imported events are excluded from Google/CalDAV mirror reconciliation and never overwritten
  by sync. New `candidateToScheduleEventInsert()`; in both `approveSourceCandidates` and
  `insertAndAutoApproveSourceCandidates`, branch `kind === "event"` → insert a `schedule_events`
  row (`source: "imported"`, `is_checked_in: false`, `is_immutable: true`, `calendar_id:
  cal-tasks`) and set `approved_event_id`. `task`/`deadline` keep the task path. Extend
  `undoSourceCandidateApproval` to delete by `approved_event_id`. Verify dedup
  (`loadExistingCommitments`) catches event-kind against existing events. Tighten the
  extraction prompt to distinguish event vs deadline vs task. TaskManager becomes tasks-only
  with no change to the component — routing drains it upstream.
- **Slice B — provisional events on the grid.** Render `source === "imported" && !isCheckedIn`
  with the amber border + a confirm checkmark; confirm PATCHes `is_checked_in` via
  `/api/events/[id]`. Ensure imported events are passed as hard events to the planner even
  when unconfirmed.
- **Slice C — delete AutoImportDigest.** Remove the panel + wiring; its provenance/undo job
  moves in-place: events confirm/reject on the grid, freshly imported tasks get a provisional
  marker + confirm/reject inline in the TaskManager. The `/undo` endpoint stays as "reject."
- **Slice D — relocate Plan Basis.** Move the Plan Basis section out of `ContextRailPanel` to
  a collapsed disclosure in the schedule header ("Plan basis · N sources · built Xm ago",
  semantic color only when stale/failed), scoped to the active plan.

Build order A → B → C → D (C's event half depends on B). One migration. Right rail ends at
two panels: "Needs you" + tasks-only TaskManager.

## Check-in and the daily digest

What exists today is reactive, not proactive: a check-in is block confirmation plus
mood/energy (`checkins` table, `/api/checkin`), the re-entry recap is computed on dashboard
load after a 2-day gap, and there is an automation audit log. There is **no outbound
notification system at all** — no push, no email, no scheduled summary; only transient
in-app toasts. So a "notification system" is something to define, mostly by unifying the
reactive pieces into one rhythm rather than building push from scratch.

Direction, matched to the spare brand voice (no ceremony):

- **Pull-first.** The daily digest is an in-app card seen on open, not an interruption.
  Build it in the spirit of the re-entry recap (calm, dismissible, honest, only appears
  when there is something).
- **One daily heartbeat, not a notification center.** A morning anchor surfacing the top
  1–3 actionable items. An evening "what slipped, roll forward" is a possible second beat,
  but start with one.
- **Earn the right to push.** Real push/email (doesn't exist yet) is reserved for rare,
  time-critical, actionable events — a high-priority task that could not be placed, a
  deadline due today and unscheduled. Never "here's your day."
- **Push is opt-in and configurable.** Whether JARVIS pushes at all, and what it may push
  about, is a user setting in the config/setup screen — deferred to the Settings UX
  overhaul, not built here.
- **Unify the check-in loop.** Block confirmation, re-entry recap, and the digest are three
  flavors of the same confirm/adjust loop. The coherence move is to make the daily digest
  the single check-in surface, consistent with the rail consolidation.
- **Incremental infra.** v1 computes the digest on dashboard load from current state —
  **zero new infrastructure** (same as the re-entry recap). A daily cron (same shape as
  `source-refresh` / `memory-consolidate`, `CRON_SECRET`-gated, or the local
  `com.jarvis.sync`) is only needed later, to pre-compute inferred deadlines (Workstream 2)
  and to drive any true push.

## Related, still to scope in this pass

- **Active calendar + source sync.** Verify real sync is running; ties to the known-broken
  source-refresh cron in prod. The Plan Basis chip makes that health legible.
- **Intent audit of every remaining surface element** beyond the rail.

## Resolved (2026-06-16)

- Auto-timeout window: **7 days**.
- Auto-timeout flips the task to **`missed`** (not just hide the risk).
- Notifications: **in-app daily digest first**; push/email later and gated hard.
- Archive is one reversible drawer backed by existing stores, not a new surface.
- Undated tasks: never auto-missed; handled via inferred-deadline *suggestions* (Workstream 2).
- Inference fills the gap only — explicit deadlines (user or imported) are authoritative
  and skip inference.
- Confidence: surface only with a concrete anchor + visible reasoning; no anchor → silent.
- Push is user-configurable (on/off + what), deferred to the Settings overhaul.
- Daily digest: **morning beat only** to start (no evening roll-forward yet).
- Deadlines surface: **reachable review view** (from the rail + task manager), not a
  top-level screen.
- TaskManager shows **tasks only**; imported `event`-kind items route to the calendar, not
  the task list (route by kind — the signal already exists in extraction).
- Imported events land on the calendar **provisional** (yellow border + checkmark) but are
  **treated as concrete commitments for planning immediately**; confirm only catches misfires.
- **AutoImportDigest deleted outright** — its provenance/undo job moves in-place onto each
  item's provisional marker.
- Plan Basis **relocates** out of the rail to a per-term disclosure above the calendar.
- Right rail collapses from **four panels to two**: "Needs you" + a tasks-only TaskManager.

## Open questions

None blocking — the plan is settled. Remaining choices (snooze durations, exact digest
copy, surface placement if volume grows) are implementation-time details.
