# JARVIS Roadmap

> **How to use this doc.** This is the living plan. Read it first, then the linked
> decision docs in `docs/decisions/` and the council reports in `docs/council/`.
> Rewritten **2026-06-25** to reflect a pivot: from a single-user operator tool to a
> **multi-user student product**. The old phase plan (iMessage digest, operator
> daemon, companion app) is superseded — see "What changed" below.

## North star

JARVIS is **one trusted system that consolidates a student's fragmented stack**
(calendar, Canvas/LMS deadlines, email, notes, to-dos) and **proactively keeps them
on top of it** — with **low setup** and the **user in control**. Cloud-first,
web-first, multi-user. The brain lives in the cloud; clients are thin surfaces on
top of it.

**The spine (don't drift from this):** *consolidation first* (JTBD Cluster 3 —
"collapse my scattered tools into one system, low setup, me in control"), with
proactivity as a feature *inside* consolidation, not a separate product. See the
`project-jarvis-jtbd-customer-research` memory.

## What changed (2026-06-25 — the pivot)

The product was built single-user with David as operator. That phase proved the hard
parts (the brain, the connectors, the data model, the dashboard). It's now being
repackaged for real users. Decisions locked this session:

- **Multi-user is the priority.** The single-user pilot is no longer enough. This
  reorganizes everything below. (`project-jarvis-multiuser-priority`)
- **SMS / Telnyx is dropped.** No EIN → 10DLC brand can't verify; per-user TCPA +
  carrier caps + cost make SMS the worst multi-user channel. Park Telnyx entirely.
- **The operator Mac daemon was killed** (it long-polled a serverless function 24/7
  and burned ~45 GB-hrs/day on Vercel). It's operator-only and doesn't generalize.
  (`project-jarvis-raycast-daemon` — cost gotcha)
- **The native Mac app is parked** (council, 2026-06-25, 4–1). It bundled three
  founder-shaped roles and targeted the one channel (iMessage) with no cloud API.
  Full reasoning: `docs/council/council-report-20260625-151747.html`.
- **Gmail + Drive stay in scope** — non-negotiable for a consolidation tool.
  Customer-validated (May). OAuth verification (incl. `gmail.readonly` restricted +
  CASA) is therefore on the critical path, in review since 2026-06-22.
- **Client surface = web/PWA**, not native. Phone-first (students live on phones).

## Already shipped (as of 2026-06-25)

- Dashboard overhaul + coherence pass (PRs #10/#11/#48/#49/#51).
- **Agent empowerment** — real agentic tool-use loop, Opus 4.8 (PR #63).
- **Notion two-way sync + structured task facets** (PR #52).
- **Settings overhaul + proactivity-digest core** (PR #65) — dispatcher/digest code
  is in `main` but **dormant** (no cron on Hobby; channel being reframed to push).
- **Syllabus upload** (School sources reorg).
- **P5 production login branding** — custom domain `secretaryjarvis.com`, Supabase
  custom auth domain, `/privacy` + `/terms`, branded Google consent. Login no longer
  shows the raw `*.supabase.co` host.
- Brand logo + favicon; triple-sign-in auth fix; landing redesign.

## The near-term spine (build in roughly this order)

### 0 — Clear the Google OAuth verification  ·  *the real gate (in review)*
Nothing onboards real students behind the unverified-app / restricted-scope warning.
It's largely a *waiting* task (CASA for `gmail.readonly` is the long pole) — let it
bake in the background; build the rest in parallel. (`project-jarvis-oauth-domain-production-todo`)

### 1 — The second-user test  ·  *do this first, it's not a build*
Recruit one real Cluster-3 student (a friend juggling Canvas + Notion + calendar) and
watch them onboard onto the existing web app end-to-end. Build nothing first. What
breaks for a non-you user — and what they ask for unprompted — should reorder
everything below. (Council 2026-06-25, "the one thing to do first.")

### 2 — Multi-user hardening
Web-first signup → a connect-your-connectors onboarding wizard → verify per-user data
isolation (RLS) → remove operator-only assumptions. The bar is small and concrete: *a
second person can sign up and it just works.* Not "scale" — "works for someone who
isn't David."

### 3 — PWA + web-push  ·  *the surface + the proactive channel*
Turn the existing app into an installable PWA (home-screen icon, full-screen) with
web-push. This is the multi-user contact surface and replaces SMS as the proactive
channel. **Caveat:** iOS Safari web-push is weak (requires home-screen install, can be
flaky) — so treat the **notification channel as its own decision** (web-push vs email
digest) validated against real users, not an assumption. Days of work, reuses the
shipped app.

### 4 — "X → Calendar" engine  ·  *the flagship wedge (council #2, 2026-06-27)*
Customer-validated job: *events mentioned anywhere should land on my calendar without
manual copying.* **Build it source-AGNOSTIC and decoupled from the Gmail gate:** a
single **extract → propose → you approve → write to Google Calendar** engine (with a
**source receipt** + an **idempotency key** so retries never double-book). Wire it
FIRST to inputs already cleared — **Canvas / Notion / Todoist + a manual email
paste/screenshot** — so the magic moment ships NOW instead of sitting dark behind
CASA. **Gmail is a bolt-on input the day OAuth clears**, not a prerequisite. The
calendar *write* is the real risk (a wrong event burns trust) → the approve-gate is
non-negotiable. Much of the plumbing exists (candidate extraction from Canvas/Notion;
Google Calendar write) — the new work is treating an arbitrary message as a source +
a clean one-off propose/approve UX. **iMessage is NOT how you serve this** (parked
shelf). Full reasoning: `docs/council/council-report-20260627-150732.html`.
(`project-jarvis-jtbd-customer-research`)

### 5 — Consolidation-core depth (the JTBD-named gaps)
Strengthen the actual "one trusted system," because this is the chosen job and JARVIS
under-serves parts of it:
- **Dead-simple, fast onboarding** — the #1 differentiator vs Notion. Onboarding speed
  is a core feature, not plumbing.
- **Keep the user in control** — the auto-planner placing blocks is a Motion-like risk;
  the user must stay in the driver's seat (they rejected Motion for taking over).
- **Notes** — one of the four pillars (calendar + notes + to-dos + time); JARVIS is thin.
- **Time-tracking / recaps** — a named want JARVIS basically lacks.

## The parked shelf (deliberately deferred — don't re-argue these)

Each is parked *with a reason* so it stays decided:

- **iMessage integration** → *serve it LAST.* It's the one channel with no cloud API
  (Apple locks it to local `chat.db` + Full Disk Access on a Mac), so it's structurally
  the highest-friction. When it comes, prefer a light **share-sheet "send this text to
  JARVIS"** (user-in-control, no full-disk scraping) over a scraping daemon.
- **Native Mac app** → *parked* (council 2026-06-25). Reconsider only with a validated
  cohort that wants on-device depth and will grant the permissions.
- **Local-sensor "moat" (on-device context)** → real long-term differentiator, but a
  later bet and **lean iOS, not Mac** (that's where students are).
- **Companion desktop app / "Claude Code in JARVIS" sandbox endgame** → future,
  unscheduled. (`project-jarvis-companion-app-and-proactivity-vision`)
- **CalDAV external-event write** → waits for a client with a writable local calendar.
  Phase-1 calendar items stay immutable task-blocks; Google push via approved sync.
- **SMS / Telnyx** → dropped (no EIN, high friction). The dormant digest code stays put.
- **The assertive iMessage digest** → reframed: the *job* (proactive nudges) survives,
  the *channel* moves to push/email.

## Data model (canonical — unchanged, still accurate)

Two entities, **not** "everything is a task":

- **`tasks`** — to-dos. Two independent dates: **`deadline`** (when it's *due*) and
  **`scheduledFor`** (when you plan to *do* it). Status: `todo → scheduled →
  completed | missed`. Flags: `is_immutable`, `all_day`.
- **`schedule_events`** — calendar blocks; nullable **`taskId`** links back to a task.

The reconcile (`lib/reconciliation.ts`, pause-gated): **auto-miss** (deadline 7+ days
past → `missed`, block deleted; undated never auto-miss — *a feature*); **stale block**
(past `source=task` block → `unconfirmed`); **re-queue** (past mutable scheduled task →
`todo`, planner re-places it; immutable never re-queued).

**DECISION (2026-06-19, still pending execution): collapse `imported` into the task
model + retire `focus`** so `ScheduleEventSource` = **`task | calendar`**. A timed
extracted event becomes a task (`is_immutable: true`, `scheduledFor` = its time, **no
`deadline`**) whose block is `source: "task"`. Guardrail: imported-as-task stays
immutable + deadline-less so the planner never reschedules an appointment and auto-miss
never fires (it goes `unconfirmed` = "did you attend?"). This now also underpins
feature #4 (messages → calendar): extracted events become immutable task-blocks.

## Open decision

- **Proactive notification channel:** web-push (PWA) vs email digest vs both. iOS
  web-push reliability is the risk; decide against real users (tie to spine #1/#3).

## Opportunistic cleanups (fold in when touching that code)

- Canvas extension command claim — make it a true compare-and-swap.
- `infer-deadlines` runs twice (cron + every plan build) — dedupe.
- `approveSourceCandidates` / `buildDailyPlan` non-transactional — orphan risk.
- Google write-back has no idempotency key — duplicate event on retry (matters for
  feature #4).
- Notion tokens stored `expiresAt: null`, no refresh code.
- Execute the `imported`→task collapse + `focus` removal; check for ghost
  `unconfirmed` blocks after re-queue.

## Recommended starting point (council #2, 2026-06-27)
Do these three at once — they reinforce each other:
1. **Build the smallest "X → calendar" approve-flow that needs NO Gmail** (#4) — paste
   an email / pull a Canvas or Notion item → propose event → you Approve → it lands on
   Google Calendar with a source receipt. One screen, one already-cleared connection.
   This is the demo, the wedge, and the proof — before you spend a week on the
   OAuth-gated pipeline.
2. **Minimum RLS slice** (part of #2) so a second user can't see the first's data.
3. **Put it in front of 2–3 real students this week** (#1) — kills the n≈1 risk (the
   pain is founder-validated, not stranger-validated yet).

Let #0 (OAuth) bake in the background; Gmail bolts onto the #4 engine the day it clears.
