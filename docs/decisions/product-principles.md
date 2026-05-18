# Product Principles

JARVIS is a secretary-second-brain scheduler. It should not merely place blocks on a calendar; it should preserve context, explain tradeoffs, and help each authenticated user recover when plans change.

## Core Behavior

- Use real user data only. Empty states are acceptable; fake state is not.
- Treat priorities as relative weights, not absolute overrides.
- Prefer zero-tradeoff schedules first: preserve due work, routines, commitments, sleep, and preparation when feasible.
- When a tradeoff is unavoidable, name what is compressed, deferred, or at risk.
- Destructive actions need explicit approval unless the user has clearly requested that exact change.
- External users receive a generic student-planning secretary template by structure only. Do not seed David-specific tasks, deadlines, courses, or personal facts into another user's account.
- Master Input is a universal assistant surface: it classifies requests, chooses the right memory/source layers, routes day planning through the shared planner, and creates approval records for executable external writes.
- Master Input should answer the user as dialogue with a personal-secretary posture: attentive, context-aware, and ready to coordinate tasks, schedule, memory, and source state. If a message is not a recognized write command, JARVIS should still respond directly using available context, or surface a clear model/configuration failure instead of returning a generic receipt.
- Secretary dialogue and scheduling use Claude, with an explicit Sonnet/Opus planner choice for scheduling. Source extraction and helper classification may still use OpenAI until migrated. Missing API keys, model failures, and source failures are hard errors, not occasions for local placeholder replies.
- Imported Google Calendar events are trusted as commitments by default: medium priority, fixed in place, and editable from the event itself.

## Integration Direction

- Google Calendar is implemented as a DB mirror.
- Notion and Gmail ingestion should create source snapshots and reviewable source candidates before changing the schedule.
- Gmail scans combine a latest-mail context lane with a wider keyword lane for deadlines, submissions, applications, opportunities, internships, and research context; dedupe before extraction so the scan is broader without reprocessing the same email twice.
- Canvas is implemented as a personal-access-token pilot for a single client. Canvas planner items are trusted enough to auto-create/update local tasks, but token storage remains private and broad multi-user production should move to Canvas OAuth.
- Uploaded syllabi/screenshots/text are first-class context sources: preserve the original file, extract candidate scheduling facts, then ask for approval.
- The daily command deck should answer "what now, why, what next, what is at risk" from the latest plan rather than asking the user to maintain a planning system manually.
- Default planning horizon is today plus the next seven days.
- Calendar writes remain in-app-first; outward sync is a separate approved/explicit action path.
- CalDAV-style sources are modeled through source snapshots for future ingestion.
- Google OAuth tokens are stored only from the callback/reconnect flow. Source refresh routes consume stored tokens but must not refresh integration state from a browser session.
- Source read failures must be surfaced clearly and must not be replaced with guessed content.
- Connected/runnable source failures block pre-plan scheduling. Unconfigured sources are reported as missing coverage, not as failures.
- The Sources surface should show Google Calendar and Gmail as separate connector statuses even though they share the same Google OAuth token, so users can recover the exact source blocking planning.
- Source failure snapshots stay in history for auditability, but a newer successful reconnect or token refresh should clear the active connector warning until that source fails again.
- Planner output is validated before persistence. Individual task placements that violate hard calendar constraints are left unscheduled with an explicit tradeoff/risk instead of causing the entire plan to fail.
- Google Calendar task-block writes require explicit approve/cancel execution from the pending assistant tool run. Canvas writes are limited to direct user task completion syncing through planner overrides; no assignment submission, grading, file, or comment writes are supported.
