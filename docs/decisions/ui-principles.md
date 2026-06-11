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
- Pending external assistant writes should render as compact receipt controls with approve/cancel actions. The UI should refresh dashboard state after execution and display the real execution error if approval fails.
- Keep freeform natural-language commands inside the secretary surface. The schedule command strip may offer fixed quick replans, but it should not render another command input.
- Do not show unused connectors as missing required context in the plan basis. Source setup may show available connectors with honest auth-needed, ready, connected, or failed states tied to real actions.
- Source setup connector rows should pair text labels with a compact status icon so missing config, auth-needed, ready, connected, and failed states are scannable without reading every sentence.
- Source setup is titled Sources, not Connectors. Group sources by user intent: Calendar, Tasks & Courses, Work Context, Files, and In Development.
- Connector detail panes should expose a compact enabled switch. Off means the source stays connected but does not refresh or contribute to planning.
- Connector setup should ask for the minimum human-known credentials. For CalDAV, default to Apple Calendar with Apple ID email plus app-specific password, and expose raw server URL only through the Custom CalDAV path.
- Calendar visibility is the explicit duplicate-control mechanism for mirrored calendar providers. Group calendar display controls by provider so users can hide duplicated CalDAV/Google feeds while keeping provider-specific calendars visible.
- Missing app-level connector config should not make connector entry points disappear or feel unavailable. Keep the action visible and surface the concrete setup error when invoked.
- Treat Inbox as a context surface, not only an approval queue. If a source scan produced useful context but no pending task candidates, show the recent source digest instead of an empty-feeling review ledger.
- Source counts should represent distinct active source types, not historical refresh snapshots.
- Candidate review should favor a compact deadline calendar grouping over a long checkbox-card list; undated items should stay compact and secondary.
- On wide screens, the daily command strip belongs beside the schedule as a left command panel so it does not push the calendar down.
- The Claude Sonnet/Opus planner choice belongs beside the daily planning controls as a compact segmented control, not in a modal or settings detour.
- In the right rail, prefer spacing and muted surfaces for local grouping. Reserve strong rules for major region breaks so the panel does not become a stack of equal dividers.
- Imported Google events default to medium priority and fixed in place. Do not expose the full backlog as a review queue; event-level changes belong on the calendar event context menu.
- The Canvas Reader control surface should use a dense Finder-style browser on wide screens: left rail for setup/actions, then Courses, Tabs, Items, and Detail columns. Keep status visible at the top and surface real command events/errors rather than generic sync copy.
- Canvas Reader queued commands should read as waiting on the Chrome extension, and the UI should offer an explicit wake action because command creation and browser-extension execution are separate steps.
- Canvas Reader expansion controls belong in the empty target column after the user selects a course or tab. Avoid row-level refresh icons for this flow; use a clear orange `Expand` command where tabs/items will appear.

## Layout Rules

- The first screen is the product, not a landing page.
- Main surface: daily command strip plus schedule.
- Secondary surfaces: source intake, review ledger, risk/source context, command input, task queue, sync state.
- The command strip should foreground Now, Why, Next, and replanning in one glance.
- The review ledger is the approval boundary for extracted source facts.
- Controls should keep stable dimensions to avoid layout shift.
