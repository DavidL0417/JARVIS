# JARVIS-note daemon — the Raycast "JARVIS" note ⇄ cloud JARVIS bridge

The "JARVIS" Raycast note (id `C8C158FD-188D-495E-AC0F-F6B5987AD364`) is the
operator's interactive surface with the cloud JARVIS app. A local Mac daemon bridges
it both ways. This is P2 of the 2026-06-19 daemon plan; the brain that turns captures
into actions is P3.

## Why a local daemon at all

The Raycast Notes DB is SQLCipher-encrypted on the operator's Mac; Vercel can't reach
it and never sees the key. So a local process does the Mac-side I/O, talking to the
cloud over HTTP behind the operator secret. The Mac is unaddressable from Vercel, so
the **cloud→Mac** direction is a daemon-initiated long-poll (the daemon reaches out),
not an inbound push.

## The two directions

**Capture (you → JARVIS)** — `daemon.py capture`, triggered by the "Send to JARVIS"
Raycast command (ambient FSEvents later). WAL-aware read of the JARVIS note → diff vs
last-sent hash → `POST /api/integrations/jarvis-note/capture`. Non-destructive. Phase 0
proved Raycast edits are readable within ~2–8s with no quit, so an explicit "Send" is
trivially reliable.

**Serve (JARVIS → you)** — `daemon.py serve --allow-writes`. Holds a long-poll on
`POST /api/integrations/jarvis-note/commands/poll`; the endpoint atomically claims the
oldest pending command and returns it (or `null` after the hold). The daemon applies it
to the note, then `POST /api/integrations/jarvis-note/commands/complete`. **This mutates
the encrypted Raycast DB** — see the safety model below.

## The confirmation handshake (checkbox ack)

A control command (e.g. "mark the MLM work done") becomes a `confirm` command. The
daemon writes `- [ ] ⚠️ Confirm: <action>? (#<ackToken>)` into the note. The operator
ticks it `[x]`. The next capture reports the ticked token; the cloud sets `acked_at` on
the matching command. The act-then-delete (the cloud acting on the ack and queuing a
`delete_lines` to remove the confirm + command lines — *deletion is the done-signal*) is
the P3 brain's job; P2 stops at recording the ack.

## The cloud half (this repo) — shipped, tested, not deployed

- `supabase/migrations/20260619140000_jarvis_note_daemon.sql` — `jarvis_note_commands`
  (queue), `jarvis_note_captures` (inbound log), and `claim_next_jarvis_note_command`.
- The claim is a **true atomic CAS** (`FOR UPDATE SKIP LOCKED` in the RPC). This is
  deliberately **NOT** the Canvas extension's `SELECT … pending` then unguarded
  `UPDATE … running` (`app/api/integrations/canvas/extension/worker/poll/route.ts`),
  which races: two pollers can select the same row and both claim it.
- `schemas/jarvis-note.ts`, `lib/jarvis-note/commands.ts`, three operator-gated routes
  under `app/api/integrations/jarvis-note/`, and `tests/jarvis-note-commands.test.ts`.
- Auth reuses `requireRaycastOperator` (env `RAYCAST_INGEST_SECRET` +
  `RAYCAST_OPERATOR_USER_ID`); unconfigured deployments 404, same as the Raycast intake.

## The local half — `scripts/jarvis-note/daemon.py`

- **Reads** reuse this repo's `scripts/raycast/push-notes.py`.
- **Writes** reuse the **Claude - Scheduler** writer (`scripts/claude_note_board.py` +
  `raycast_notes_export.py`): its quit→write→relaunch path, `backup_db()`, the
  markdown↔ProseMirror converters, and — critically — its single
  `memory/ledgers/.claude-note-board.lock`. Importing `cnb` binds that exact lock, so
  the daemon and the Scheduler's board/to-do writers **never write the DB concurrently**
  (quit-relaunch makes overlap corrupting). The Scheduler is told to expect this third
  writer in its `memory/jarvis-note-boundary.md`, and its reader excludes the JARVIS note.
- Writes target the JARVIS note id only, are **surgical** (insert/remove specific
  ProseMirror nodes — never round-trip David's lines), **never touch `openedAt`**, and
  enforce the same guards as the Scheduler writer: refuse on `deletedAt`, hard-refuse on
  `syncId`, require `documentSchemaVersion == 2`.

## Safety model for the live write path

The write path is gated behind `--allow-writes` (default OFF); `serve` refuses to run
without it. Defense in depth on each write: the shared lock (no concurrent writer),
`backup_db()` before the write (last 5 kept), `rows=1` assertion, and a read-back verify
(`fresh document == intended document`). Per the guardrail, the **first live `serve` run
must be done with David present**; do not install the launchd agent until that run is
clean.

## Deferred / supervised steps (NOT done here)

1. **Apply the migration** to the Supabase project (additive; supervised).
2. **Set env** in the JARVIS deployment: `RAYCAST_INGEST_SECRET`,
   `RAYCAST_OPERATOR_USER_ID` (already set for the Raycast intake — reused as-is).
3. **First live `serve --allow-writes`** with David present (the guardrail).
4. **Seed the JARVIS note** (currently empty) with an initial heading — itself a live
   write, so it rides step 3.
5. **Install launchd** (`com.jarvis.note-daemon.plist.template`) only after step 3 is clean.
6. **Ambient capture** via FSEvents (explicit "Send to JARVIS" ships first).
7. **The brain (P3)** — interpret captured commands → queue actions → act-then-delete.

## Daemon commands

```
python3 scripts/jarvis-note/daemon.py selftest             # wiring check; no writes/network
python3 scripts/jarvis-note/daemon.py capture [--dry-run]   # you → JARVIS (read + upload)
python3 scripts/jarvis-note/daemon.py serve --allow-writes  # JARVIS → you (supervised)
```
