# JARVIS Roadmap

> **How to use this doc.** This is the living plan, written 2026-06-19. Each new
> work-chat should read this first, then the linked decision docs in
> `docs/decisions/`. Phases are meant to be tackled one chat at a time, roughly in
> order. When you finish a phase, update its status here.

## North star

JARVIS should be a **capable + proactive** assistant — one that actually *does*
things (not a chatbot that hedges) and *reaches out* to David over iMessage to
keep him on top of his work — instead of an offline scheduler he has to open.
Today it's too coupled to the offline Claude-Scheduler model: everything is in-app
**pull**, there's zero off-device push, the Mac `launchd` is the heartbeat, and
compute fires only when the dashboard is opened. The plan below breaks that.

## Current shipped state (as of 2026-06-19)

- **Sync-system audit + spec** done — `docs/decisions/sync-system-spec.md`.
- **Critical safety bugs fixed** (commit `255e853`): Apple-Reminders empty-snapshot
  data-loss guard; `reconcileStaleSchedule` now honors the pause flag; operator
  secret `.bak` deleted.
- **Sync decisions #1 + #2 shipped** (PR #61, branch `feat/sync-decisions-1-2`):
  auto-approve-only candidate pipeline (non-approved → `dismissed`, not stranded
  `pending`; Canvas reclaims dismissed; 172 prod pendings cleared); calendar
  feedback-learning loop gated OFF.
- **Gmail is connected & working** (the audit's "Gmail dark" finding was stale).
- **Raycast↔JARVIS ambient daemon LIVE** (PRs #53–#60) — the operator Mac daemon
  is the working prototype of the future companion app + the cloud→Mac command
  channel. See `docs/decisions/jarvis-note-daemon.md`.

## Data model (canonical, with the 2026-06-19 refinement decision)

Two entities, **not** "everything is a task":

- **`tasks`** — to-dos. Two independent dates: **`deadline`** (when it's *due*) and
  **`scheduledFor`** (when you plan to *do* it). Status: `todo → scheduled →
  completed | missed`. Flags: `is_immutable`, `all_day`.
- **`schedule_events`** — calendar blocks; nullable **`taskId`** links back to a task.

The reconcile (`lib/reconciliation.ts`, runs on dashboard GET + plan build, now
pause-gated) does three things:
- **Auto-miss** — a task whose `deadline` is 7+ days past → `missed`, block deleted
  ("give up / archive"). Undated tasks never auto-miss. *This is a feature.*
- **Stale block** — a past `source=task` block → `unconfirmed` ("did you do this?").
- **Re-queue** — a past mutable scheduled task → back to `todo`; the planner
  re-places it as a new block. Immutable tasks are never re-queued.
  - *Open refinement to verify:* does the old `unconfirmed` block get cleaned up
    when the task is re-placed, or do ghost `unconfirmed` blocks accumulate?

**DECISION (2026-06-19): collapse `imported` into the task model + retire `focus`.**
- Today `ScheduleEventSource` = `task | calendar | imported | focus`.
  - `task` = a planner block for a task (`task_id` set, mutable/reschedulable).
  - `calendar` = a real external meeting mirrored from CalDAV/Apple/Google.
  - `imported` = a JARVIS-extracted event with a concrete time, placed provisionally
    (`task_id: null`, `is_immutable: true`, `is_checked_in: false`).
  - `focus` = **dormant** — no active creation site.
- **Change:** everything that is **not** a real external calendar meeting gets a
  `task_id`. A timed extracted event becomes a **task** (`is_immutable: true`,
  `scheduledFor` = its time, **no `deadline`**) whose block is `source: "task"`.
  Retire `imported`; retire `focus`. Result: `ScheduleEventSource` = **`task |
  calendar`**.
- **Guardrail (critical):** imported-as-task must stay `is_immutable: true` and
  deadline-less so JARVIS never reschedules an appointment like laundry and
  auto-miss never fires — it just goes `unconfirmed` ("did you attend?") afterward.
- **Migration:** convert existing `source=imported` rows to task-backed (or leave
  them and stop creating new ones) — decide at implementation time. Drop `focus`
  handling.

---

## The phases

### Phase 0 — Merge PR #61  ·  *ready*
Sync decisions #1 (auto-approve-only) + #2 (feedback loop off). Already reviewed,
typecheck clean, full suite 274/274, prod pendings cleared. Just merge.

### Phase 1 — Agent Empowerment  ·  ⭐ *recommended start*
**Goal:** make JARVIS *act* end-to-end instead of hedging. Same brain across the
Cmd+K Secretary and the JARVIS-note daemon: `lib/assistant/secretary.ts`
(`runSecretaryTurn`) + `lib/assistant/orchestrator.ts` (intent classifier).
**Today's failure:** narrow intent set; most "actions" just set a reply string; it
discusses/asks permission instead of doing (couldn't write CalDAV, asked "what do
you want me to change?" instead of resolving from context).
**Work:**
- Widen the tool/action set + wire **real executors**: CalDAV event create/update/move,
  task-field edits, reschedule, read Gmail (now connected) + iMessage to answer.
- Make the loop **agentic**: resolve from available context before asking;
  **act-then-confirm** for risky writes via the JARVIS-note ⚠️ Confirm handshake
  that already exists.
**Why first:** it's the foundation — a proactive nag from an agent that can't then
help you act is half a product. Detail: `project-jarvis-agent-empowerment-todo`
memory; verify against `docs/decisions/secretary-memory.md` + the calendar model.

### Phase 2 — Proactivity v1: the iMessage digest
**Goal:** JARVIS reaches out. The visible payoff of the whole reframe. **Standalone
server→iMessage feature — does NOT depend on the companion app.**
**Pieces:**
- **Pause = the consent gate.** Extend `isAutomationPaused` so it also gates push:
  live = allowed to act + reach out; paused = silent (saves money — the point of pause).
- **Move the reconcile/auto-miss server-side** (sync decision #3) so JARVIS *notices*
  misses on a schedule instead of only when the app is opened.
- **Evidence-awareness:** cross-reference online signals (email unreplied? Canvas
  still unsubmitted? any activity?) so it can say "I found no evidence you've worked
  on X." *Caution:* a false-negative nag ("you didn't do X" when you did) burns
  trust — bar assertive nags to verifiable signals, or hedge when unsure.
- **Cadence (decided): planner (morning)** — "here's your day / what'll crunch you" —
  **+ nag (evening)** — "did you actually do it / no evidence, get it done now."
- **Channel (decided): iMessage, NOT SMS.** iMessage has far higher response/retention.
  Use an **iMessage-API provider (Linq / SendBlue-style), not Twilio**. Operator
  today: outbound iMessage already works via the Mac daemon.
- Ship with **sensible defaults** — the config UI comes in Phase 3.

### Phase 3 — Settings + welcome/config screen
**Goal:** now that the digest exists, expose its knobs + redesign Settings. Redesign
the Settings panel (`RailSheet`), add a **first-run welcome/configuration screen**,
and **proactivity controls** (digest cadence, tone/assertiveness, channel, quiet
hours, what counts as "urgent"). Detail: `project-settings-ux-overhaul-todo` memory.

### Phase 4 — Companion app (light)
**Goal:** first step beyond operator-only. A **downloadable onboarding shell** —
"Hey, let's set up Reminders / let's set up iMessage" — productizing the operator
daemon per-user with permission. **Consolidate Apple Reminders via EventKit**
(replacing the operator Shortcuts POST). **Explicitly NOT in scope near-term:**
sandbox, file uploads, the "Claude Code in JARVIS" agentic-local endgame — that's
future plans, kept on the horizon, not built. Detail:
`project-jarvis-companion-app-and-proactivity-vision` memory.

### Phase 5 — Production
**Goal:** ready for real users; clear the scary unverified-app screen. Stand up a
**custom domain** (Vercel app + Supabase custom auth domain), **configure + verify
the Google OAuth consent app** (name, logo, Privacy Policy + ToS, authorized
domains), repoint redirect URIs. Can slot earlier if demoing externally. Detail:
`project-jarvis-oauth-domain-production-todo` memory.

### The "Claude Code in JARVIS" endgame (future, unscheduled)
Once the companion app exists: JARVIS notices an un-downloaded email attachment →
the local app fetches it to the user's folder → ships it to a **secure server-side
sandbox** where the agent works on it. Big lift (sandbox infra, security, trust).
Kept in future plans; not on the near-term path.

---

## Cross-cutting decisions (from the 2026-06-19 discussion)

- **Pause is the consent/spend boundary**, not just "skip crons." Live ⇒ JARVIS may
  act server-side and reach out. Paused ⇒ silent.
- **iMessage over SMS, always** (Linq/SendBlue-style provider). Text is the chosen
  off-app channel; Raycast is rejected for it (incoherent operator secret).
- **The digest is standalone** (server→iMessage), independent of the companion app.
- **Companion app stays light** near-term (onboarding only).
- **Operator vs product seam:** iMessage + Raycast are currently *pure operator
  secrets* (`lib/imessage/operator-auth.ts`, operator-id+bearer 404 gate); the
  companion app + an iMessage-API provider are how they generalize to real users.

## Opportunistic cleanups (fold in when touching that code)
- Canvas extension command claim — make it a true compare-and-swap (no `status='pending'`
  re-check today; `app/api/integrations/canvas/extension/worker/poll/route.ts`).
- `infer-deadlines` runs twice (cron + every plan build, error-swallowed) — dedupe.
- `approveSourceCandidates` / `buildDailyPlan` non-transactional — orphan risk.
- Google write-back has no idempotency key — duplicate event on retry.
- Notion tokens stored `expiresAt: null` with no refresh code.
- Data-model tidy: execute the `imported`→task collapse + `focus` removal above;
  check for ghost `unconfirmed` blocks after re-queue.

## Recommended starting point
**Phase 1 — Agent Empowerment.** Highest-leverage foundation, already teed up,
Gmail unblocked. Everything proactive compounds on a JARVIS that can actually act.
