# JARVIS Sync System Spec

*Definitive operator reference. Covers every path that moves data between an external system and JARVIS (Supabase/Vercel), the two schedulers that drive them, idempotency, what reaches the user, and live health. Last verified against code + `~/.jarvis/sync.log` on 2026-06-19.*

---

## 1. Overview — data flows

There are exactly **two schedulers** in the whole system (verified complete: no Supabase edge functions, no LaunchDaemons, no user crontab; only `com.jarvis.sync` is loaded — the old `com.jarvis.imessage-reader` is retired to a `.bak`):

- **Local launchd** `com.jarvis.sync` → `~/.jarvis/sync.sh` at **08:00 / 14:00 / 20:00 America/Los_Angeles**. Drives **only** the two operator Mac readers (Raycast, iMessage). Nothing else.
- **Vercel cron** (3 jobs, UTC): `source-refresh` `0 10`, `memory-consolidate` `0 9`, `infer-deadlines` `30 10`.

Everything else is **event-driven** (user click, extension poll, iOS Shortcut, dashboard load, assistant approval).

```
INBOUND (external → JARVIS)
                                                              ┌─────────────────────────┐
  Gmail  ─────────(Vercel source-refresh cron 10:00Z)──────► │ LLM extraction          │
  Notion ─────────(cron + pre_plan + manual import)────────► │ (extraction.ts)         │──► source_candidates
  Canvas REST ────(cron, DORMANT: no REST token)───────────► │                         │       │
  Canvas extension(extension poll loop, event-driven)──────► │                         │       ▼ auto-approve
  iMessage ───────(launchd 3×/day local → POST ingest)─────► │                         │   (kind∈task/deadline/event
  manual paste ───(user click → POST /api/sources/paste)───► │                         │    + dueAt + conf≥0.85
  manual upload ──(user click → POST /api/sources/upload)──► └─────────────────────────┘    + not dup)
                                                                                              │
  CalDAV/Apple ───(cron + manual)──┐  1:1 / mirror (NO LLM)                                   ▼
  Google Calendar (cron+pre_plan+  ├──────────────────────────────────────────────► schedule_events / tasks
                   manual)         │                                                          │
  Notion (1:1 mirror, NO LLM) ─────┘                                                          ▼
  Apple Reminders (iOS Shortcut → POST ingest, full-snapshot mirror, NO LLM)──► tasks    DASHBOARD (pull)
  Raycast notes ──(launchd 3×/day → POST ingest, snapshot only, NO LLM)──────► source_snapshots → assistant ctx

OUTBOUND (JARVIS → external write-back)
  task complete/reopen/edit/delete ──► Notion page (checkbox / fields / archive)   [event-driven, best-effort]
  task complete ─────────────────────► Canvas planner override                     [event-driven; DORMANT]
  task blocks ───────────────────────► Google Calendar events                      [assistant-approval-gated only]

READ-TIME RECONCILIATION (no external system)
  GET /api/dashboard, buildDailyPlan ─► auto-miss / unconfirm / return-to-todo + Needs-you rail (in-app)

DERIVED-DATA CRONS (no external system)
  infer-deadlines (30 10Z + every plan build) ─► tasks.inferred_deadline (suggestion, never silent write)
  memory-consolidate (0 9Z) ─────────────────► memory_items status=superseded

AUTH FOUNDATION (gates the two Google subsystems)
  Supabase signInWithOAuth(google) → app/auth/callback → upsertGoogleCalendarIntegration
    two tiers: identity-only (NO scope) vs source-authorization (calendar.readonly + gmail.readonly)
```

**Critical user-push fact:** there is **no off-device notification infrastructure anywhere** (no web-push/FCM/APNS/email/SMS/Twilio — grep-confirmed across `lib`, `app`, `components`). Every "push" in this spec is **in-app only** (dashboard rail / task surfaces / assistant card). All inbound paths surface results passively; the user must open the app.

---

## 2. Master table

| Path | What's synced | Direction | Cadence | Trigger conditions | Idempotent? (mechanism) | Pushes to user? | Health |
|---|---|---|---|---|---|---|---|
| **Central local orchestrator** (`sync.sh` + launchd) | Drives Raycast + iMessage readers | n/a (scheduler) | launchd 08/14/20 **local** | CONFIG + `JARVIS_APP_URL`/`JARVIS_REPO` required; per-reader secret soft-gates | Guaranteed (holds no state; delegates) | No (file log only) | **Degraded** — intermittent (Mac-awake-dependent), not slot-deterministic |
| **Raycast notes** | Full notes snapshot (context only) | In (read) | launchd 3×/day | `RAYCAST_INGEST_SECRET` (local) + secret+`RAYCAST_OPERATOR_USER_ID` (server); 404 else | Guaranteed (content-hash idle-skip; no tasks) | No (pull status card + passive assistant ctx) | **Healthy** |
| **iMessage/SMS** | Allowlisted messages → extraction | In (read) | launchd 3×/day | bearer+operator-id; local allowlist filter; cursor | Partial (cursor + GUID upsert + content-hash + candidateKey) | No (in-app candidates/tasks) | **Degraded** — works when network up; silent DNS misses |
| **Shared source-refresh** (`refreshSourcesForUser`) | Fan-out of all 5 cloud sources | n/a (orchestrator) | Vercel cron `0 10`; + pre_plan | `CRON_SECRET`; not-paused; connector enabled; per-source gate | Partial (per-source idle-skip; non-atomic candidateKey) | No (pull-side risk rail) | **Healthy** (17+ completed runs, 0 failed) |
| **Gmail** | Inbox recency+keyword search → extraction | In (read-only) | cron `0 10` + manual "Scan Gmail" | connector on + status connected + **`gmail.readonly` scope** | Partial (contentHash idle-skip + dedup key) | In-app (auto-approve tasks/events; reauth prompt) | **Degraded → DARK** — scope missing in prod, "skipped" since ~06-12 |
| **Notion** | Tasks DB ↔ tasks (authoritative) | **Two-way** | In: cron+pre_plan+manual. Out: event-driven | connected + `selected_source_id`; out: `last_synced_from='notion'` | Guaranteed (unique `(user_id,external_task_id)`) | No (silent) | **Healthy** |
| **CalDAV/Apple + Google Calendar** | Remote events → `schedule_events` mirror | In (read) | cron `0 10` + pre_plan + manual | connector on + connected + creds/scope | Guaranteed (upsert on stable external id) | No (silent) | **Healthy** |
| **Google write-back** | task blocks → Google events | Out (write) | **None** — assistant approval only | tool-run `pending_approval`+action match + Google token | Partial (PATCH-vs-POST by stored gcal id; no idempotency key) | In-app (assistant card) | **Healthy by construction** (no run history) |
| **Canvas REST** | Planner items ↔ tasks/override | Two-way | cron `0 10` + manual | connected + base_url + **REST access_token** | Partial (plannableKey upsert) | No (in-app tasks) | **Degraded — DORMANT** (no REST token in prod) |
| **Canvas extension** | Course tree + page/file content | Two-way (control plane) | **Event-driven** (extension poll) | bearer token; origin-binding on content routes | Partial (unique node/content keys; **non-atomic command claim**) | No (in-app Canvas reader + tasks) | **Healthy** (dormant unless extension paired) |
| **Apple Reminders** | Incomplete reminders → tasks | In (full-snapshot mirror) | **Event-driven** (iOS Shortcut) | bearer token; connector on | Guaranteed-ish (hash of list+title+due) **but destructive reconcile** | No (in-app) | **Healthy** (no empty-snapshot guard) |
| **Manual paste / upload** | Pasted text / file → extraction | In (read) | **Event-driven** (user click) | authed session; ≤50MB (upload) | Partial (candidateKey + dup gate) | No (in-app candidates/tasks) | **Healthy** |
| **Candidate→task landing** (`persistence.ts`) | source_candidates → tasks/events/memory | n/a (shared sink) | per-source (above) | confidence≥0.85 + dueAt + task-kind to auto-approve | Partial (DB unique dedup key; non-transactional approve) | In-app count badge only | **Degraded** — manual review UI **unwired**; 170 pending stranded |
| **infer-deadlines** | suggested by-when on undated tasks | Derived | cron `30 10` + every plan build | `CRON_SECRET`; not-paused; ≤50 undated tasks | Guaranteed (idempotent recompute + retract) | In-app (Needs-you suggestion) | **Healthy** |
| **memory-consolidate** | semantic-dup memory retire | Derived | cron `0 9` | `CRON_SECRET`; not-paused; ≥2 active in a layer | Partial (active-status guard) | No (silent) | **Healthy** (writes NO automation_runs) |
| **Read-time reconciliation** | auto-miss / unconfirm / return-to-todo | Derived | **Every dashboard load + plan build** | authed; stale rows exist | Guaranteed (status-filtered UPDATEs) | In-app (Needs-you rail, recap) | **Healthy** — but **ignores pause** (destructive on passive GET) |
| **Google/Gmail OAuth connect** | mints/stores Google tokens | Auth foundation | Event-driven (sign-in) | Supabase `signInWithOAuth(google)` | n/a | n/a | **Degraded** — identity-tier sign-in yields scopeless "connected" row |
| **Calendar-feedback loop** | Google-side edits → preference candidate | In (write, hidden) | Inside every Google inbound refresh | ≥2 similar observations in 14d | Dedup by signature (24h) + existing-candidate check | No (pending preference candidate; review UI unwired) | **Healthy** (silent) |

---

## 3. Per-path detail

### 3.1 Central local orchestrator (`sync.sh` + `com.jarvis.sync`)
- **Entities:** invokes `scripts/raycast/push-notes.py` and `scripts/imessage/read-chat-db.mjs`; sources `~/.jarvis/sync.env`; iMessage cursor `~/.jarvis/imessage-cursor.json`; only output sink is `~/.jarvis/sync.log`.
- **Cadence:** launchd `StartCalendarInterval` Hour 8/14/20 Minute 0, **America/Los_Angeles**, `RunAtLoad=false`, `ProcessType=Background`. **This is the only scheduler for the two readers.**
- **Conditions:** CONFIG must exist (else FATAL); `JARVIS_APP_URL`+`JARVIS_REPO` hard-required (`:?`); each reader runs only if its secret is set, else SKIP.
- **Idempotency:** holds no state; delegates fully to the readers/server.
- **User-push:** none.
- **Health — corrected (the prior maps had this inverted):** PDT=UTC−7, so **08:00 local = 15:00Z, 14:00 local = 21:00Z, 20:00 local = 03:00Z next day**. Tallying `sync.log` banners: the **15:00Z (08:00-local) slot is 4/4 SUCCESS** — it is the *most* reliable slot, not the failing one. Failures cluster at the **03:00Z (20:00-local, overnight-coalesced) slot** (06-16 FAILED, 06-18 coalesced to 03:14Z FAILED) plus one 21:00Z fail on 06-15. The latest four runs (06-18 15:00Z, 06-18 21:00Z, 06-19 03:00Z) are all `raycast: ok, imessage: ok`. **Net: failures are intermittent and Mac-awake-dependent, not slot-deterministic in either direction.** Also: not all failures are DNS — the 2026-06-15T06:06Z run was an HTTP 404 secret/feature mismatch on a **manual** (off-cadence) run, not a scheduled miss.
- **Key files:** `/Users/david/.jarvis/sync.sh`, `/Users/david/Library/LaunchAgents/com.jarvis.sync.plist`, `/Users/david/.jarvis/sync.env`, `/Users/david/.jarvis/sync.log`, `/Users/david/.jarvis/imessage-cursor.json`.
- **Risks:** single point of failure for both readers; silent failure (launchd ignores exit; only the log records it); hardcoded `NODE_BIN=/opt/homebrew/bin/node` (holds FDA for chat.db); **`~/.jarvis/com.jarvis.imessage-reader.plist.bak` embeds the live `IMESSAGE_INGEST_SECRET` + prod URL in plaintext — should be scrubbed/deleted.**

### 3.2 Raycast notes intake (one-way, operator-only)
- **Entities:** SQLCipher Notes DB → `push-notes.py` → `POST /api/integrations/raycast/ingest` → `source_snapshots` (source='raycast', freshness='fresh'); pull-only status card; digest flows into assistant context (`lib/assistant/context.ts:271`).
- **Cadence:** launchd 3×/day. Not a Vercel cron.
- **Conditions:** local secret gate; server requires `RAYCAST_INGEST_SECRET`+`RAYCAST_OPERATOR_USER_ID`, timing-safe token, indistinguishable 404 on any miss.
- **Idempotency:** **guaranteed** — content-hash idle-skip is the sole mechanism (no DB unique constraint). Hash covers note `id+modifiedAt+markdown` only.
- **User-push:** none (no tasks/candidates ever created).
- **Health:** **healthy.**
- **Key files:** `scripts/raycast/push-notes.py`, `lib/raycast/ingest.ts`, `lib/raycast/operator-auth.ts`, `lib/sources/idle-skip.ts`, `app/api/integrations/raycast/{ingest,status}/route.ts`.
- **Risks:** hash blind to title/pin (mirror can lag); append-only `source_snapshots` growth (no prune, unlike iMessage); single-machine fragility (Keychain salt/ProseMirror schema).

### 3.3 iMessage / SMS intake
- **Entities:** `chat.db` snapshot → `read-chat-db.mjs` (all filtering local) → `POST .../imessage/ingest` → `app_private.imessage_messages` (full archive) → shared pipeline. Also `GET /filter-config` (allowlist pull) and `POST /suggestions` (replace-all). Console UI is session-gated.
- **Cadence:** launchd 3×/day; manual `--imessage-only / --backfill / --dry-run`.
- **Conditions:** `IMESSAGE_INGEST_SECRET`; FDA on node; `JARVIS_APP_URL` must resolve. Server: bearer + `IMESSAGE_OPERATOR_USER_ID`, else 404. Local include rule: allowlisted handle, or non-shortcode 1:1 with two-way traffic in 30d.
- **Idempotency:** **partial** — (1) local cursor advances past *all* scanned rows incl. filtered-out (`read-chat-db.mjs:595`); backfill never advances it (`:607`); (2) GUID upsert `ON CONFLICT DO NOTHING`; (3) content-hash idle-skip + candidateKey dedup. **Risk:** cursor is a single unbacked-up file — loss + no `--backfill` re-scans 7d → different transcript → re-extraction; **allowlist-add does not retroactively forward** (cursor already past those rows).
- **User-push:** none off-device; auto-approve lands tasks/events in-app.
- **Health:** **degraded** — wired and working when network resolves; silent DNS misses (no alerting).
- **Key files:** `scripts/imessage/read-chat-db.mjs`, `lib/imessage/{ingest,store,operator-auth,handles}.ts`, `app/api/integrations/imessage/*`, migration `20260614120000_imessage_operator_console.sql`.
- **Risks:** silent failure; single bearer secret (no rotation); auto-approve writes real tasks from casual texts.

### 3.4 Shared source-refresh pipeline + daily cron
- **Entities:** `refreshSourcesForUser` fans out Google Cal, CalDAV, Gmail, Notion, Canvas; writes `automation_runs` (one row/user/run) and failure snapshots; reads `connector_settings` (default-on).
- **Cadence:** Vercel cron `0 10 * * *` (observed drift to 10:06/10:34/10:50Z + an off-schedule 23:38Z manual run on 06-18); also `pre_plan` inside `buildDailyPlan` (force=true, **but `force` is a dead flag — never read in refresh.ts**).
- **Conditions:** `CRON_SECRET` bearer (401 else); pause→`skipped_paused`; per-source connector + integration gate; idle-skip.
- **Idempotency:** **partial** — per-source idle-skip + candidateKey dedup; but `automation_runs` is plain-append (no unique key → double-fire duplicates audit rows); candidateKey read-then-insert is non-atomic (2000-row cap) so cron + pre_plan overlap can double-insert; **pre_plan refreshes write NO automation_run** (under-reported).
- **User-push:** none (failed snapshots → in-app risk rail, capped at 2).
- **Health:** **healthy** (17+ completed, 0 failed/skipped_paused).
- **Key files:** `lib/sources/refresh.ts`, `app/api/cron/source-refresh/route.ts`, `lib/automation-runs.ts`, `lib/supabase/connector-settings.ts`, `vercel.json`.

### 3.5 Gmail (inbound extraction)
- **Entities:** two search lanes (recency `newer_than:21d`, keyword) → assembled text (text/plain only, 1600 chars/msg) → contentHash idle-skip → Claude extraction → `source_snapshots`/`source_candidates` → auto-approve.
- **Cadence:** cron `0 10` + manual `POST /api/gmail/sync`. **No historyId/cursor** — re-scans the rolling 21-day window every run.
- **Conditions:** connector on + `status='connected'` + **scope contains `gmail.readonly`** (`hasOAuthScope`). Missing scope → silent `skipped`.
- **Idempotency:** partial (contentHash + DB unique `source_candidates_user_dedup_key`). LLM reword/date-shift busts the exact key → only fuzzy `findDuplicateCommitment` catches dups.
- **User-push:** in-app — auto-approved dated tasks/events; reauth flips `needs_reauth`.
- **Health — DARK in prod.** Last 2 gmail snapshots (06-12) are `failed/reauthorization_required`; cron reports gmail `skipped` every run since ~06-12. Root cause is the **OAuth scope boundary (§3.18)**: operator's google integration is `needs_reauth` and the "connected" ones lack `gmail.readonly`. Cron health shows all-"completed", masking that no email has ingested for ~3 weeks. The dashboard does not distinguish "skipped (no scope)" from "off (toggle)".
- **Key files:** `lib/sources/gmail-refresh.ts`, `app/api/gmail/sync/route.ts`, `lib/google-oauth.ts`, `lib/supabase/google-calendar-integration.ts`, `lib/sources/extraction.ts`.
- **Risks:** silent "dark"; text/plain-only body (HTML emails degrade); no cursor (re-pays LLM on busy mailbox); auto-approve writes immutable events on a confident-but-wrong dueAt.

### 3.6 Notion two-way sync
- **Inbound:** `refreshNotionForUser` cursor-paginates the selected DB (page_size 100, cap 1000), reconciles completion/removal (**delete gated on `complete===true`** — a truncated pull never prunes), resolves course/category, mirrors open pages 1:1 into `tasks` keyed by `external_task_id`.
- **Outbound (event-driven, best-effort `.catch(()=>null)`):** PATCH complete/reopen → checkbox flip; PATCH title/deadline → field PATCH; DELETE → page archive. Gated on `last_synced_from='notion' && external_task_id`. Audited to `change_logs` (no UI consumer).
- **Cadence:** In: cron `0 10` + pre_plan + manual import. Out: synchronous in `/api/tasks/[id]` PATCH/DELETE.
- **Idempotency:** **guaranteed** — unique `(user_id, external_task_id)`; completion `.neq('status','completed')`; outbound PATCHes set absolute values.
- **User-push:** none (silent; surfaces via tasks table).
- **Health:** **healthy** (code + migrations confirmed; prod last-run not re-queried this session).
- **Risks:** last-write-wins (a JARVIS edit racing a Notion edit is overwritten on next inbound); failed outbound title/deadline PATCH is **reverted** by next inbound; status-select-only DBs have no checkbox to flip (completion silently no-ops); **Notion token stored `expiresAt:null` with no refresh path** (`lib/notion.ts` only throws `NOTION_REAUTH_REQUIRED` on 401/403 — confirmed, not speculative).
- **Key files:** `lib/sources/notion-refresh.ts`, `lib/sources/notion-completion.ts`, `app/api/tasks/[id]/route.ts`, `lib/notion.ts`, `app/api/integrations/notion/{import,database,callback}/route.ts`, migrations `20260612140000`, `20260618000000`.

### 3.7 Calendar ingestion (CalDAV/Apple + Google read mirror)
- **Entities:** CalDAV VEVENT (tsdav, ical.js, recurrences ≤500, 90d-back/180d-ahead) and Google `events.list` (`singleEvents=true`) → `schedule_events` (read-only mirror, `is_immutable=true`); calendars table; failure → integration status. **VTODO/Apple-Reminders-via-CalDAV is a hard no-op** (`supportsTodos()` returns false unconditionally).
- **Cadence:** cron `0 10` + pre_plan + manual (`POST /api/integrations/caldav/import`, `POST /api/google-calendar/events`). Not local.
- **Idempotency:** **guaranteed** — CalDAV upsert on `(user_id, external_event_id)` (deterministic hash); Google upsert on `(user_id, gcal_event_id)`; planner-owned fields preserved; 365-day prune.
- **User-push:** none.
- **Health:** **healthy.**
- **Hidden write loop — calendar-feedback (gap, now mapped, §3.19).**
- **Risks:** **CalDAV has no within-window stale reconciler** (orphan rows linger ≤365d); **Google aborts the whole user's sync on any single-calendar fetch failure** (`google-calendar-events.ts:738`) while CalDAV tolerates partial; series time-shift mints new CalDAV ids → duplicate occurrences.
- **Key files:** `lib/caldav/refresh.ts`, `lib/caldav/events.ts`, `lib/google-calendar-events.ts`, `lib/supabase/schedule-events.ts`.

### 3.8 Google Calendar write-back (task blocks → Google)
- **Entities:** `syncTaskEventsToGoogleForUser` reads `source='task' AND status='scheduled' AND ends_at≥now`; PATCH if `gcal_event_id` stored, else POST; writes returned id back; tags `extendedProperties.private.source='jarvis_task'`.
- **Cadence:** **none** — only caller is the assistant approve route (`app/api/assistant/tool-runs/[id]/approve/route.ts:57`).
- **Conditions:** tool-run `pending_approval` + `requires_approval` + `payload.action==='google_task_event_sync'` + valid Google token.
- **Idempotency:** **partial** — dedup by stored `gcal_event_id`, **no idempotency key sent to Google**; if the write-back `.update()` fails after a successful POST, a re-approval POSTs a **second Google event**. Non-transactional sequential loop; mid-loop failure marks the whole run `error` and the 409 blocks re-approval (recovery needs a brand-new tool run).
- **User-push:** in-app assistant card.
- **Health:** healthy by construction (no run history; user-initiated only).
- **Risks:** duplicate events on retry; **no outbound stale cleanup** (deleted/unscheduled blocks linger on Google).

### 3.9 Canvas REST (planner pull + override write-back)
- **Entities:** In: `GET /api/v1/planner/items` (−14/+90d) → candidates/tasks. Out: `markCanvasTaskComplete` POSTs/PUTs a planner override on task completion.
- **Cadence:** cron `0 10` + manual import; out: event-driven on PATCH `status=completed`.
- **Idempotency:** partial (plannableKey upsert; overrideId persisted back).
- **User-push:** none.
- **Health — DEGRADED/DORMANT.** `get_integration_token(...,'canvas')` returns `[]` — **no REST token in prod**, so cron skips Canvas every run ("not connected with a base URL and access token"). The integration row shows `status=connected` because the **browser-extension path** maintains it, masking that the REST pull/write-back has never run successfully. Likely the user only ever connected via the extension, never the REST connect flow.
- **Risks:** masked failure; dedup-key divergence (in-app plannableKey vs DB unique `(user,kind,title,due_at,course)` over dismissed rows → INSERT abort); **task resurrection** (deleting an auto-imported Canvas task re-creates it next refresh); reopen does not clear the override (one-way drift).
- **Key files:** `lib/sources/canvas-refresh.ts`, `lib/sources/canvas-completion.ts`, `lib/canvas.ts`, `lib/supabase/canvas-integration.ts`.

### 3.10 Canvas browser-extension control plane
- **Entities:** pairing code → hashed bearer token → poll/report worker loop → `canvas_extension_commands` / `_nodes` / `_sessions` / `_command_events`; content via `import-page` (LLM extraction → candidates), `sync-content`, `import-file`/`import-file-content` (→ `source-originals` bucket), `extract-stored-file`. **Read surfaces (gap, now mapped): `GET .../extension/file-url` (signed Storage URL) and `GET .../extension/page-content` (stored markdown), both session-authed.**
- **Cadence:** **purely event-driven** (extension poll loop; 90s liveness window). No cron/launchd.
- **Conditions:** worker/import routes need a valid non-revoked bearer token; content routes additionally enforce origin-binding (403); control routes need an authed session.
- **Idempotency:** partial — strong unique keys on nodes/content/sessions; **command claim is NOT atomic.** Verified at `worker/poll/route.ts:120-121`: the claiming UPDATE filters only `.eq("id",…).eq("user_id",…)` with **no `.eq("status","pending")` re-check** — so there is no compare-and-swap; **even a single client double-polling double-claims** (broader than "two tokens"). `source_snapshots` are plain INSERTs (grow unbounded); file uploads use fresh random-uuid paths with `upsert:false` (orphan blobs on re-import).
- **User-push:** none (in-app Canvas reader + tasks).
- **Health:** healthy server-side; dormant unless an extension is paired + polling (no server heartbeat).
- **Risks:** double-execution; pairing never revokes prior tokens (accumulate); `sync-content` replace-children can overwrite a fuller tree with a partial report; discover deletes root non-course nodes wholesale.

### 3.11 Apple Reminders + manual paste/upload
- **Apple Reminders:** iOS Shortcut → `POST .../apple-reminders/ingest` (bearer) → **full-snapshot mirror** into `tasks` (`last_synced_from='apple_reminders'`, immutable), preserving planner-owned fields, then **reconciles removals by deleting every mirrored task absent from the payload + its schedule_events**.
- **Paste/upload:** session-authed → LLM extraction → candidates → auto-approve. Upload ≤50MB → `source-originals`.
- **Cadence:** event-driven (Shortcut run / user submit). No schedule.
- **Idempotency:** Apple Reminders keyed on `sha256(list+title+dueDate)` (not a stable Apple UID — rename/retime ⇒ new id ⇒ old task deleted, scheduling lost). Paste/upload: candidateKey + dup gate.
- **User-push:** none.
- **Health:** healthy (code).
- **HIGH-SEVERITY data-loss path (confirmed, no guard):** `lib/apple-reminders/ingest.ts:263-280` deletes `staleIds` with **no empty-snapshot or minimum-count guard**, and `schemas/apple-reminders.ts` allows `reminders:[]`. **A single empty/partial Shortcut POST wipes every mirrored reminder task** (and their schedule_events), no soft-delete. Recommend an `if (reminders.length===0) skip` guard.
- **Key files:** `app/api/integrations/apple-reminders/{ingest,connect}/route.ts`, `lib/apple-reminders/ingest.ts`, `app/api/sources/{paste,upload}/route.ts`.

### 3.12 Source-candidate → task landing (shared sink)
- **Entities:** `insertAndAutoApproveSourceCandidates` → `source_candidates` (pending) → auto-approve dated task/deadline/event (conf≥0.85, non-dup) → `tasks`/`schedule_events` (source='imported')/`memory_items`.
- **Idempotency:** partial — DB unique `source_candidates_user_dedup_key (user_id,kind,title,due_at,course)` NULLS NOT DISTINCT over **all** statuses (dismissal permanent); `findDuplicateCommitment` demotes look-alikes to pending. **`approveSourceCandidates` is non-transactional** (mid-loop failure orphans tasks); dedupe corpus windowed (tasks≤300, events 7d/120d).
- **User-push:** in-app **count badge only.**
- **Health — DEGRADED.** The **manual approve/undo/PATCH routes have zero in-repo client callers** — the review queue is unwired; **170 pending candidates are stranded** in prod with no way to promote them. (Open: was a review drawer ever shipped, or is auto-approve-only the intended design?)
- **Key files:** `lib/sources/persistence.ts`, `lib/dedupe.ts`, `app/api/sources/candidates/{route,approve,undo}.ts`, migration `20260611120000`.

### 3.13 infer-deadlines (derived cron)
- Per-user, CRON_SECRET-gated; loads ≤50 undated open tasks + dated anchors → Claude → caches `inferred_deadline`/`_reason` (**never writes real `deadline`**); retracts stale suggestions. Surfaces in Needs-you rail / Deadlines drawer; user Accept promotes, Dismiss suppresses.
- **Cadence:** cron `30 10` **and every plan build** (`daily-plan.ts:715`, error-swallowed → that branch is invisible).
- **Idempotency:** guaranteed (idempotent recompute + retract by id).
- **Health:** healthy (2 completed `deadline_inference` runs 06-18 10:32Z).
- **Risks:** duplicate LLM spend (cron + plan-build); 50-task limit ⇒ out-of-window stale suggestions never retracted; missing `ANTHROPIC_API_KEY` ⇒ daily `failed` runs (no graceful skip, unlike consolidate).

### 3.14 memory-consolidate (derived cron)
- CRON_SECRET-gated; Claude judges semantic near-dups in 2+-member layers → `status='superseded'` + `supersedes_id` + a `change_logs` row. `?dryRun=1` previews.
- **Idempotency:** partial (`.eq('status','active')` guard + `buildSupersedeOps` safety).
- **Health:** healthy (1 superseded row + matching change_log 06-16 09:35Z).
- **Risk:** **writes NO `automation_runs` row** — invisible in the audit surface, harder to monitor than infer-deadlines; a wrong LLM merge needs manual un-merge.

### 3.15 Read-time reconciliation + Needs-you surfacing
- `reconcileStaleSchedule` runs on **every `GET /api/dashboard` (route.ts:608)** and at `buildDailyPlan` start (`daily-plan.ts:710`): 7-day auto-miss (deletes task schedule_events), past-block→unconfirmed, stale-scheduled→todo; logs a `reconciliation` automation_run only on change. `buildNeedsYou` is a pure read-time overlay (rail, archive, suggestions). Check-in, risk decisions, pause toggles are user-action-driven.
- **Idempotency:** guaranteed (status-filtered UPDATEs).
- **User-push:** in-app rail/recap/suggestions/archive.
- **Health:** healthy.
- **CONFIRMED CRITICAL GAP (elevate to fact):** `isAutomationPaused` is referenced **only** in the three cron routes — grep-confirmed absent from `lib/reconciliation.ts`, `lib/daily-plan.ts`, `app/api/dashboard/route.ts`, `app/api/daily-plan/*`. **A paused user still gets destructive 7-day auto-miss + schedule_event deletion on a passive dashboard load, and a forced pre_plan refresh on manual build.** The control-plane migration comment says automation_settings "pauses all background work" — so this is either a bug or an undocumented intentional scope. Needs a decision.
- **Risks:** auto-miss is a write path on a passive GET (irreversible except via Archive restore); no concurrency lock on builds; `recordAutomationRun` swallows errors (audit under-reports).

### 3.16 Connector enable/disable toggle (gap — now mapped)
- **`PATCH /api/integrations/connectors/[id]`** → `upsertConnectorEnabled` (session-authed; body `{enabled:boolean}`). This is the **single user control that can silently turn OFF any source's sync** (gmail/notion/canvas/caldav/google/raycast/imessage/apple_reminders) — every refresh map gates on `isConnectorEnabled` (default-on) but none named the mutation endpoint. File: `app/api/integrations/connectors/[id]/route.ts`.

### 3.17 Calendar sync-preference toggle (gap — now mapped)
- **`PATCH /api/calendars/[id]`** sets `calendars.sync_preference` (`route.ts:122`). Setting a Google/CalDAV calendar to **`ignored`** makes the next inbound refresh **delete all previously-mirrored events for that calendar** — a user-driven destructive sync trigger. The same route's DELETE reassigns `schedule_events`/`tasks`. File: `app/api/calendars/[id]/route.ts`.

### 3.18 Google/Gmail OAuth connection + scope boundary (gap — now mapped; root cause of Gmail-dark)
- **There is no dedicated Google OAuth start/callback under `app/api`** (unlike Notion). Google **Calendar and Gmail** tokens are minted via Supabase `signInWithOAuth(provider:google)` and persisted in **`app/auth/callback/route.ts:48`** (`bootstrapAuthenticatedGoogleUser` → `upsertGoogleCalendarIntegration`) — storing whatever access/refresh tokens the session carries **regardless of granted scope**.
- **Two sign-in tiers** in `lib/supabase/auth-actions.ts`:
  - `startGoogleSignInRedirect` (line 42) — **identity only, NO scopes.**
  - `startGoogleSourceAuthorizationRedirect` (line 61) — `scopes=GOOGLE_SOURCE_SCOPES` (calendar.readonly + gmail.readonly) + `access_type:offline` + `prompt:consent`.
- A user who signs in via the plain identity flow gets a **`connected` google integration row with NO `gmail.readonly`/`calendar` scope**. That connected-vs-scoped distinction is **the literal root cause of the Gmail "dark since 06-12" finding** (§3.5). This is the auth foundation of both Google subsystems.
- **Key files:** `app/auth/callback/route.ts`, `lib/supabase/auth-actions.ts`, `lib/google-oauth.ts`.

### 3.19 Google-calendar inbound feedback-learning loop (gap — now mapped)
- `recordGoogleCalendarTaskFeedback` runs **inside `syncGoogleCalendarEventsForUser`** (`lib/google-calendar-events.ts:748`) — i.e. on every Google inbound refresh (cron + pre_plan + manual). It diffs JARVIS-pushed task blocks against Google's returned events, classifies user edits made directly in Google (**moved / duration_changed / deleted**), writes each as a `change_logs` observation (`action='calendar.feedback_observed'`, deduped by signature within 24h), and **after ≥2 similar observations in 14 days INSERTs a `source_candidates` row of `kind='preference'` (confidence 0.7, pending)**.
- This contradicts the prior Calendar map's claim that inbound is "purely silent... emits no candidate." The `userPush=false` claim still holds (preference candidates are pending-only and the review UI is unwired per §3.12), but the **write of change_logs + a pending preference candidate from inbound sync is a real, previously-unmapped data flow.**
- **File:** `lib/sources/calendar-feedback.ts` (call site `lib/google-calendar-events.ts:748`).

---

## 4. Cross-cutting observations

**Idempotency posture.** Strongest where a stable external key exists: Notion (`external_task_id`), CalDAV/Google (`external_event_id`/`gcal_event_id`), iMessage archive (GUID), Apple Reminders (hash). Weakest in three places: (1) the **Canvas extension command claim is not a compare-and-swap** (no `status='pending'` re-check → double-poll double-executes); (2) **`approveSourceCandidates` and `buildDailyPlan` are non-transactional** (mid-loop crash orphans tasks / strands a thin plan); (3) **Google write-back has no idempotency key** (failed write-back POSTs a duplicate on retry). LLM non-determinism is the systemic dedup weakness everywhere — a reworded title or shifted dueAt busts the exact `(kind,title,due_at,course)` key, leaving only the conservative fuzzy `findDuplicateCommitment` gate (which only runs for auto-approve).

**Notification/push posture.** **Zero off-device push exists** — no email/SMS/web-push/APNS/FCM anywhere (grep-confirmed). Everything is in-app and **pull**: tasks/events appear silently, failures surface only on the next dashboard/plan build via the Needs-you risk rail (capped at 2), and the source-candidate review queue is a **count badge with no working approve UI**. Practical consequence: a source going dark (Gmail today, Canvas REST today) produces **no alert** — you only notice missing data.

**Scheduling overlaps / redundancy.** infer-deadlines runs **twice daily-effective** (cron `30 10` + every plan build) — convergent but doubles LLM spend, and the plan-build call is error-swallowed (invisible failures). source-refresh `pre_plan` (force=true) overlaps the cron but `force` is a **dead flag** (never read), so a user-forced replan does **not** bypass idle-skip. The 06-18 23:38Z off-schedule cron run is unexplained (manual curl vs redeploy) and worth confirming it isn't double-charging extraction.

**Single points of failure.** (1) **`com.jarvis.sync` + `sync.sh` + `sync.env`** — the only path for both Mac readers; if any is missing/malformed, both stop with no alert. (2) **iMessage cursor** — single unbacked-up local file. (3) **The shared Google integration row** — one row backs Calendar, Gmail, and (via masking) Canvas-connected state; its scope/status silently gates whether Gmail ingests at all. (4) **`CRON_SECRET`** — single shared bearer for all three Vercel crons, no rotation.

**Secret / owner-gating patterns.** Three consistent patterns: (a) **bearer + operator-id 404-gate** (Raycast, iMessage — indistinguishable 404 on any miss); (b) **bearer-only** (Apple Reminders, Canvas extension token, Vercel `CRON_SECRET`); (c) **session + operator-id** for the console UIs. All secrets are long-lived static strings with **no rotation/expiry**. Two exposure/hygiene issues: the `com.jarvis.imessage-reader.plist.bak` plaintext secret, and Notion tokens stored `expiresAt:null` with **no refresh code** (a 401 surfaces only as a failed snapshot).

---

## 5. Raycast read/write context

**What exists TODAY — one direction only (Mac → cloud, read-only):**
- `push-notes.py` decrypts the local Raycast SQLCipher Notes DB, renders ProseMirror→markdown, and **POSTs a full snapshot** to `/api/integrations/raycast/ingest`. The server stores it as one `source_snapshots` row (source='raycast'); the digest summary is the **only** downstream consumer (assistant context). **No tasks/candidates/events are ever created.** Surfacing is pull-only (operator status card) + passive assistant context. Idempotency = content-hash idle-skip. Driven solely by `com.jarvis.sync` 3×/day.
- There is **no cloud → Mac channel of any kind** today. The Mac initiates every connection (outbound HTTPS POST/GET); the cloud never reaches back to the Mac. Raycast is treated as a read-only scratchpad mirror.

**What a "read/write" fix would ADD — a genuinely new sync direction (cloud → Mac → Raycast):**
A write-back would let JARVIS create/update/complete items *in* Raycast Notes (e.g. push a task or a note back into the operator's scratchpad). That is a **new transport** the current architecture does not have. It would require:
1. **A pull/command channel the Mac polls** — the cloud has no push path to the Mac, so the Mac reader must poll a new endpoint for pending write commands (the **Canvas extension control plane in §3.10 is the existing template**: command queue + poll/claim/report loop). This implies a new command table, a claim mechanism, and a report-back.
2. **Write capability into the SQLCipher DB** — `push-notes.py` currently only *reads* (copies the DB to a tempdir). Writing means mutating Raycast's encrypted DB with the Keychain-derived key, which is fragile against Raycast schema/salt changes (already a flagged degradation risk) and risks corrupting the user's notes. A safer alternative is the Raycast extension/API surface rather than direct DB writes.
3. **Idempotency for the new direction** — today's content-hash idle-skip only protects the read; a write path needs its own dedup (a stable Raycast note id ↔ JARVIS id mapping, analogous to Notion's `external_task_id`), since Raycast notes currently have no JARVIS-side external-id column.
4. **A claim that is atomic** — do **not** copy the Canvas extension's `poll` command-claim, which is **not** a compare-and-swap (§3.10); the write path must use `SELECT … FOR UPDATE SKIP LOCKED` or a transactional RPC to avoid double-execution, especially since pairing/token reuse can produce concurrent pollers.
5. **The same secret/owner gate** — reuse the bearer + operator-id 404 pattern; introduce a write-specific secret/scope so a read token cannot trigger writes.

**Sequencing dependency (open, per memory):** the broader "sync system overhaul" (audit cadence/idempotency/alerting) is unsettled on **sync-first vs raycast-first**. Because a Raycast write-back depends on a **new poll/command transport** that does not exist yet, and because the only existing template for it (Canvas extension) has a confirmed non-atomic-claim defect, the cleaner order is: harden the orchestrator + add a correct command-queue transport **first**, then layer the Raycast write direction onto it — so the write path isn't built on the flawed claim pattern and isn't torn down by the overhaul.