# Secretary Memory Model

The backend models layered secretary memory inspired by the local scheduler workspace, without treating that workspace as literal product instructions.

## Memory Layers

- Durable preferences: stable scheduling rules and defaults.
- Task context: short-lived facts about active tasks, deadlines, scope, and estimates.
- Source observations: facts imported or observed from external systems.
- Candidate inbox: possible memories that need repeated evidence or confirmation.
- Audit/change history: what JARVIS proposed, changed, or chose not to change.

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

## Review Boundary

- Source extraction creates candidates, not automatic truth.
- Approving task/deadline/event candidates may create scheduler tasks; approving preference/routine/note candidates may create memory.
- Failed extraction or source refresh state should remain visible in source snapshots and daily-plan risk, not disappear behind an empty queue.
