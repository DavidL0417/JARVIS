# JARVIS

## Register

product

## Product Purpose

A secretary-second-brain scheduler. Single user, daily companion. JARVIS combines tasks, calendar, preferences, source snapshots, and durable memory into one operational view, then proposes plans with explicit tradeoffs the user can approve or revise. It is not a marketing surface, not a multi-tenant SaaS dashboard, not a coordination tool for teams. The first screen is the product, not a landing page.

## Users

One operator (David). Power user. Lives inside this tool through a study/work day. Reads dense information fluently, prefers icons and keyboard over labeled buttons, knows the domain (their own life). Likely accessing from a 14" laptop and a 27" monitor, often in low light, sometimes mid-task with little tolerance for ceremony.

## Brand Voice

Spare. Precise. Honest about limits. The tone of a competent assistant who sends a one-line confirmation, not a personality. Names tradeoffs explicitly. Never decorative, never reassuring, never marketing. Empty states are honest, not encouraging.

## Strategic Principles

- **Schedule-first.** The day's plan is the dominant surface. Everything else is supporting context arranged around it.
- **Real data only.** No placeholders, no demo counts, no seeded tasks, no fake recommendations. Empty is empty.
- **Tradeoffs over assertions.** When a plan compresses, defers, or risks something, the UI says so. It does not flatten the cost into "scheduled."
- **Icons over text.** Recurring controls are iconographic with tooltips. Text appears where recognition would otherwise suffer (status, summaries, inputs).
- **Density is positive.** Operator wants everything visible. Whitespace where it earns rhythm, not where it pads.
- **Stable dimensions.** Controls reserve their space; refresh and async actions never reflow the layout.
- **Approval before destruction.** Destructive assistant actions and external calendar writes require explicit confirmation.

## Anti-References

- **Productivity SaaS dark mode with a saturated accent.** Stripe-clones, Linear-clones, Notion-dashboard reflexes. Currently this is the default — the overhaul moves away.
- **The hero-metric template.** Big number, small label, supporting stats — SaaS cliché.
- **Identical card grids.** Same-sized cards with icon + heading + text repeated down the page.
- **Marketing sections inside a tool.** No "What you can do" panels, no decorative explainer copy.
- **Nested cards, glassmorphism, gradient text, side-stripe accents.** All banned.
- **Cron / Notion Calendar look.** Generic week-grid with rounded blocks and pastel chips.
- **Editorial-typographic AI workflow tool.** Big serif headlines + cream backgrounds is a saturated reflex; avoid the obvious version of it.
- **Terminal cosplay.** Monospace-everything, fake CRT glow, prompt-style cues. Specific instrumentation is fine; theming a productivity tool as a terminal is not.

## Technical Context

Next.js App Router, TypeScript, Tailwind v4, shadcn/ui as the component baseline. Geist Sans + Geist Mono. Supabase for auth/state, Claude for secretary dialogue and schedule planning, OpenAI for source extraction and helper classification, Google Calendar mirrored into Supabase. Dashboard is a single authenticated page with three live regions: schedule, task/queue, and contextual sidebars (calendars, check-in approvals).
