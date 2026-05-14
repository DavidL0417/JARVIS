# Secretary Memory Model

The backend models layered secretary memory inspired by the local scheduler workspace, without treating that workspace as literal product instructions.

## Memory Layers

Load memory in this order:

1. Operating rules.
2. Planning profile.
3. Durable preferences.
4. Task context.
5. Deadline context.
6. Calendar context.
7. Source status.
8. Feedback observations.
9. Candidate memories.

Each `memory_items` row stores both `layer` and structured `payload` so the backend can distinguish durable preference, temporary task context, source warning, behavioral observation, and reviewable candidate memory.

## Memory Rules

- Store only information that can change scheduling, prioritization, reminders, source interpretation, or secretary behavior.
- Mark contradicted memories stale or superseded instead of silently deleting history.
- Record source labels and confidence whenever a memory came from inference or an external source.
- Give memories importance labels and a plain-language importance note when they affect tradeoffs.

## Context Assembly

Scheduler and Master Input context should combine:

- active preferences,
- active task context,
- current mirrored calendar events,
- recent source snapshots,
- pending source candidates and failed source refreshes,
- the latest daily plan when one exists,
- recent observations/change logs,
- relevant memory items.

`loadLayeredSecretaryContext` is the shared context loader for Master Input, daily planning, and future assistant tools. It renders a compact markdown context block for model calls and also returns typed rows for UI/backend logic.

## Review Boundary

- Source extraction creates candidates, not automatic truth.
- Approving task/deadline/event candidates may create scheduler tasks; approving preference/routine/note candidates may create memory.
- Failed extraction or source refresh state should remain visible in source snapshots and daily-plan risk, not disappear behind an empty queue.
- Google Calendar feedback starts as factual `change_logs`. After repeated similar observations within the review window, JARVIS creates a pending `source_candidates` preference instead of silently changing scheduling behavior.
