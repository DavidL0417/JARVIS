# UI Principles

## Visual Direction

- Minimal command deck.
- Schedule-first.
- Icon-first.
- Very little visible instructional text.
- Restrained dark neutral palette with a few semantic accents.
- Typography uses Geist Sans for the interface and reserves Geist Mono for true code/technical contexts. Tabular numerals should not make labels feel like a terminal.

## Interaction Rules

- Prefer icons with tooltips for repeated actions.
- Use text labels only where recognition would otherwise suffer.
- Empty/error/auth states must be honest and compact.
- No placeholder data, demo counts, seeded tasks, or fake recommendations.
- Avoid nested cards and marketing-style sections.
- Treat the secretary panel as a transcript plus command line. Avoid filled chat boxes, decorative composer rules, and separators that do not map to a real region change.
- Keep freeform natural-language commands inside the secretary surface. The schedule command strip may offer fixed quick replans, but it should not render another command input.
- Do not show unused connectors as missing required context in the plan basis. Source setup may show available connectors with honest auth-needed, ready, connected, or failed states tied to real actions.
- Source setup connector rows should pair text labels with a compact status icon so missing config, auth-needed, ready, connected, and failed states are scannable without reading every sentence.
- Missing app-level connector config should not make connector entry points disappear or feel unavailable. Keep the action visible and surface the concrete setup error when invoked.
- Treat Inbox as a context surface, not only an approval queue. If a source scan produced useful context but no pending task candidates, show the recent source digest instead of an empty-feeling review ledger.
- In the right rail, prefer spacing and muted surfaces for local grouping. Reserve strong rules for major region breaks so the panel does not become a stack of equal dividers.
- Imported Google events default to medium priority and fixed in place. Do not expose the full backlog as a review queue; event-level changes belong on the calendar event context menu.

## Layout Rules

- The first screen is the product, not a landing page.
- Main surface: daily command strip plus schedule.
- Secondary surfaces: source intake, review ledger, risk/source context, command input, task queue, sync state.
- The command strip should foreground Now, Why, Next, and replanning in one glance.
- The review ledger is the approval boundary for extracted source facts.
- Controls should keep stable dimensions to avoid layout shift.
