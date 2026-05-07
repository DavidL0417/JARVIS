# Product Principles

JARVIS is a secretary-second-brain scheduler. It should not merely place blocks on a calendar; it should preserve context, explain tradeoffs, and help David recover when plans change.

## Core Behavior

- Use real user data only. Empty states are acceptable; fake state is not.
- Treat priorities as relative weights, not absolute overrides.
- Prefer zero-tradeoff schedules first: preserve due work, routines, commitments, sleep, and preparation when feasible.
- When a tradeoff is unavoidable, name what is compressed, deferred, or at risk.
- Destructive actions need explicit approval unless the user has clearly requested that exact change.
- Master Input should answer the user as dialogue with a personal-secretary posture: attentive, context-aware, and ready to coordinate tasks, schedule, memory, and source state. If a message is not a recognized write command, JARVIS should still respond directly using available context, or surface a clear model/configuration failure instead of returning a generic receipt.
- Secretary dialogue and scheduling use OpenAI. Missing API keys, model failures, and source failures are hard errors, not occasions for local placeholder replies.
- Imported Google Calendar events are trusted as commitments by default: medium priority, fixed in place, and editable from the event itself.

## Integration Direction

- Google Calendar is implemented as a DB mirror.
- Notion, Gmail, and CalDAV-style sources are modeled through source snapshots for future ingestion.
- Source read failures must be surfaced clearly and must not be replaced with guessed content.
