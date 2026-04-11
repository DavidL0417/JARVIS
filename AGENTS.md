# Repo Workflow Instructions

These instructions apply to the entire repository unless a deeper `AGENTS.md` adds narrower rules.

## Always Start Here

- Before making changes, read this file.
- Before making changes, identify the contributor by name. Use one of:
  - David
  - Eric
  - Cindy
- Before making changes, read that contributor's worklog within the worklogs folder:
  - David -> [`WORKLOG-david.md`](./worklogs/WORKLOG-david.md)
  - Eric -> [`WORKLOG-eric.md`](./worklogs/WORKLOG-eric.md)
  - Cindy -> [`WORKLOG-cindy.md`](./worklogs/WORKLOG-cindy.md)
- If the task touches integrated work, cross-person handoff context, or recent work combined into `main`, also read [`MAIN_UPDATE_LOG.md`](./worklogs/MAIN_UPDATE_LOG.md) if it exists.
- Treat each contributor worklog as the canonical day-to-day handoff log for that contributor's current status, recent work, active direction, and user-specific working preferences established during prior sessions. 

## Tentative Tech Stack

- This section is provisional and should be refined as the project solidifies.
- Current expected stack includes:
  - Next.js for frontend and backend
  - TypeScript
  - GitHub for source control and collaboration
  - Vercel for hosting and deployment
  - Other adjacent tooling as the project is finalized

## Contributor Roles

- Use these as coordination defaults, not hard ownership boundaries.
- Cindy: frontend specialization for onboarding, task input, and check-in UI in `v0`/Next.js
- Eric: backend and database specialization for Next.js API routes, Supabase schema, auth, and data flow
- David: AI and calendar specialization for Claude prompting, structured output, replanning logic, and Google Calendar integration

## Continuous Handoff Maintenance

- Keep personal worklogs updated as work progresses across different sessions, users, and contexts.
- During normal feature work, each contributor updates only their own worklog.
- Add a new personal log entry after completing a meaningful unit of work in the repo.
- Every personal log entry must include:
  - Timestamp
  - What is being worked on or what was worked on
  - Current status or outcome
  - Immediate next step if there is one
- Personal entries should make current ownership obvious so simultaneous work is easy to disambiguate.
- Keep entries brief and high signal. Prefer 2-5 short bullets.
- Append new entries at the top under the log section so the newest state is easiest to find.
- Do not rewrite old history unless it is plainly incorrect; add a newer correction entry instead.

## Main Integration Log

- Do not maintain a master day-to-day project worklog during parallel individual work.
- Use [`MAIN_UPDATE_LOG.md`](./worklogs/MAIN_UPDATE_LOG.md) only when work is actually combined into `main` or otherwise integrated across contributors.
- Add a summarized integration entry when combined work lands in `main`.
- Integration entries should capture the overall direction of the project at that merge point, plus immediate next steps if there are any.

## How To Use The Logs

- At the start of a task:
  - Identify the contributor by name before logging or making changes.
  - Read the newest entries in that contributor's worklog first.
  - Use them to understand the latest personal context before exploring code.
  - Read `MAIN_UPDATE_LOG.md` only when integrated or cross-person context matters.
- During work:
  - Follow the repo-specific instructions in any deeper `AGENTS.md` files that apply to touched files.
  - Keep ownership clear by naming the feature, area, or component being worked on in log entries.
- At the end of work:
  - Update that contributor's worklog with a timestamped summary of what changed and what should happen next.
- On merge or integration to `main`:
  - Update `MAIN_UPDATE_LOG.md` with a concise summary of the combined result and resulting project direction.

## Style Of Log Entries

- Be concrete, not narrative.
- Mention actual screens/components/files when useful.
- Record user direction changes when they materially affect priorities.
- If work is intentionally deferred, say so explicitly.

## Current Standing Direction

- Prefer structural stability, polish, and coherency over bolting features back on quickly.
- Stabilize and clarify the current UI before restoring previously removed functionality unless the user redirects priorities.
