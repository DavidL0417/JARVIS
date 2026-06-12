# Automation pause — one switch, two systems

JARVIS runs background work in two places:

1. **The app** — a Vercel cron (`/api/cron/source-refresh`, daily) that refreshes
   sources per user.
2. **The local Claude scheduled tasks** — four jobs on David's laptop
   (`scheduler-morning-brief`, `scheduler-midday-sentinel`,
   `scheduler-evening-retro`, `scheduler-weekly-horizon`) that operate the
   offline `Codex - Scheduler` workspace and can push notifications.

A single pause switch must gate **both**. The switch lives in the app
(`automation_settings` table, toggled from the dashboard Settings panel or by
telling the secretary "pause updates"). The app cron reads it directly. The
local tasks read it over a read-only HTTP probe.

## How the local tasks honor the switch

Each task begins with a **pause gate** that calls the app's read-only status
endpoint and exits early when paused. It is *safe by default*: if the app is
unreachable or the probe is unconfigured, the task proceeds as before (offline
fallback), and a local flag file provides a manual override.

The endpoint is intentionally separate from `CRON_SECRET` — it is read-only and
lower-stakes, authed with `AUTOMATION_STATUS_TOKEN`.

### Environment (set where the scheduled tasks' shell can see them)

```sh
export JARVIS_APP_URL="https://<your-vercel-app>"        # or http://localhost:3000 in dev
export JARVIS_AUTOMATION_STATUS_TOKEN="<AUTOMATION_STATUS_TOKEN value>"
```

`AUTOMATION_STATUS_TOKEN` must also be set in the app's environment
(`.env.local` / Vercel project env) for the endpoint to accept the bearer token.

### The pause-gate snippet (paste as the FIRST step of each SKILL.md)

```
PAUSE GATE (run FIRST, before any refresh/push/write): check whether David has
paused background automations.

Run:
  curl -fsS --max-time 5 -H "Authorization: Bearer $JARVIS_AUTOMATION_STATUS_TOKEN" "$JARVIS_APP_URL/api/automation-status"

- If the JSON has "paused": true  → STOP. Log one line ("skipped: automations paused")
  to your shadow/board log and exit. Do NOT refresh sources, push, or write memory.
- If the JSON has "paused": false → proceed normally.
- If the request fails / times out / is unconfigured → proceed normally (offline
  fallback), BUT first: if the file ~/.claude/scheduled-tasks/.paused exists, STOP
  as if paused (manual override).
```

### Manual override (works offline)

```sh
touch ~/.claude/scheduled-tasks/.paused   # force-pause all local tasks
rm    ~/.claude/scheduled-tasks/.paused   # resume
```

## Why this shape

- **One switch gates everything** — the dashboard toggle is the single source of
  truth; the local probe inherits it.
- **No re-coupling of memory** — the probe is a one-way, read-only control bit.
  It does not move Codex memory into the app or vice-versa.
- **Safe by default** — an unreachable app never silently kills the local tasks;
  it falls back to today's behavior, with the flag file as a deliberate offline
  override.
