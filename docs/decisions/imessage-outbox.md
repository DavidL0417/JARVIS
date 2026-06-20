# iMessage outbox — the cloud → you SEND channel (Phase 2)

The proactivity feature (Phase 2) needs JARVIS to **reach out** over iMessage — the
morning planner, the evening nag, and reply confirmations. The Mac is not addressable
from Vercel, so outbound delivery is a **launchd-driven PULL/claim/report channel**,
the exact mirror of the JARVIS-note daemon (see [jarvis-note-daemon.md](./jarvis-note-daemon.md)).

## Shape

- **`imessage_outbox`** (migration `20260620204130_imessage_outbox.sql`) — the queue.
  The cloud inserts a row (service-role only); the daemon claims + sends it.
  - `claim_next_imessage_outbox_command(p_user_id, p_worker)` is a **true atomic CAS**
    (`FOR UPDATE SKIP LOCKED`, `returns setof`) — deliberately NOT the Canvas
    select-then-update race, and SETOF so an empty queue serializes as `[]`.
  - `dedup_key` + a partial unique index `(user_id, dedup_key)` give **drift-proof
    idempotency**: the dispatcher sets `'<kind>:<local-day>'`, so a re-fired Vercel
    cron can't double-send. Replies/manual sends leave it NULL (no dedup).
  - `context jsonb` carries the task ids a digest referenced, for the reply loop to
    correlate an inbound "done" back to what was nagged.
- **Routes** `app/api/integrations/imessage/outbox/{poll,complete}` — operator-only,
  gated by `requireImessageOperator` (`IMESSAGE_INGEST_SECRET` + `IMESSAGE_OPERATOR_USER_ID`),
  returning an indistinguishable 404 otherwise. `/poll` long-polls (maxDuration 30,
  25s clamp); `/complete` is guarded on `status='claimed'` so a stale report is a no-op.
- **`lib/imessage/outbox.ts`** — `enqueueOutboxMessage` / `claimNextOutboxMessage` /
  `completeOutboxMessage`, the thin DB wrappers (mirrors `lib/jarvis-note/commands.ts`).
- **`scripts/imessage/send-daemon.py`** — the Mac daemon: `serve` long-polls, claims,
  sends via `osascript` (Messages.app), reports. `send` is a one-off direct send to
  isolate the osascript path. Both are gated behind `--allow-send`.

## Operator setup (supervised — the guardrail)

Sending texts a real person, so the first run is **supervised**, like the note daemon:

1. **App env** (Vercel + `.env.local`): `IMESSAGE_INGEST_SECRET`, `IMESSAGE_OPERATOR_USER_ID`
   (already set for the iMessage reader). The digest enqueuer also needs
   `IMESSAGE_OPERATOR_HANDLE` (the recipient — your own Apple ID/number for self-delivery).
2. **Migration** applied to the DB the app uses.
3. **Automation permission**: the first `osascript` send triggers a macOS prompt to let
   python control Messages — approve it. (launchd-spawned python may need its own grant;
   verify after installing the plist.)
4. `python3 scripts/imessage/send-daemon.py send --to "<your handle>" --text "test" --allow-send`
   to prove the osascript path, then `serve --allow-send` for the loop.
5. Only after a clean supervised run, install `com.jarvis.imessage-send.plist.template`.

v1 is operator-only and self-delivery; a Linq/SendBlue-style provider drops in behind
the same enqueue interface at multi-user (Phase 4). See [operator-only-imessage.md](./operator-only-imessage.md).
