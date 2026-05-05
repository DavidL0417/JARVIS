# UI Principles

## Visual Direction

- Calm late-night planning workbench.
- Schedule-first with command and setup rails in support.
- Icon-first for repeated actions, text for primary or ambiguous actions.
- Restrained OKLCH dark neutral palette with rare semantic accents.
- Brief public landing page for signed-out users, not a long marketing site.

## Interaction Rules

- Prefer icons with tooltips for repeated actions.
- Use text labels only where recognition would otherwise suffer.
- Empty/error/auth states must be honest and compact.
- No placeholder data, demo counts, seeded tasks, or fake recommendations.
- Avoid nested cards and marketing-style sections.
- Onboarding should be inline, dismissible, replayable, and connected to real setup actions.
- First-run value is a real generated plan from real constraints and tasks.

## Layout Rules

- The first screen is the product, not a landing page.
- When signed out, show a concise one-page landing surface with Google sign-in.
- When signed in, the main surface is the schedule and current operational context.
- Secondary surfaces are command input, onboarding/setup, task queue, memory/source status, sync state, and check-ins.
- Controls should keep stable dimensions to avoid layout shift.
- Default schedule focus is 3 days on desktop and 1 day on mobile, with 7-day and month views available.
- Timeline bounds should adapt around workday, current time, and visible events instead of always showing a full empty 24-hour grid.
