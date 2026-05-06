# JARVIS Design (current snapshot, pre-overhaul)

This file documents the existing dark-SaaS surface so the overhaul has a reference point. The new direction will replace most of it.

## Color (current)

Dark, restrained. OKLCH neutrals tinted toward cool indigo (hue ~282). Single rust/orange primary at oklch(0.77 0.12 24).

- background: oklch(0.19 0.024 282)
- card: oklch(0.235 0.022 286)
- border: oklch(0.34 0.022 286)
- foreground: oklch(0.96 0.008 85) — warm off-white
- muted-foreground: oklch(0.78 0.012 85)
- primary: oklch(0.77 0.12 24) — rust
- destructive: oklch(0.52 0.18 21)

## Typography (current)

- Sans: Geist
- Mono: Geist Mono
- Hierarchy is flat: most type sits at text-xs / text-sm. Headings rarely exceed text-base. Weight contrast is the only differentiator.

## Layout (current)

- Single full-height shell, max-width 1680px, 12px padding.
- Left rail: 48px wide vertical strip with 3 icon buttons (calendars, refresh, schedule).
- Header: full-width card, logo + title + sign-out.
- Stat row: 4 equal pills (Tasks, Loose, Memory, Sources).
- Body: 2-column grid (1fr | 390px). Schedule view left; master input + check-in + task manager stacked right.
- Calendars sidebar opens as a Sheet from the left.

## Components in use

shadcn/ui baseline (full set installed). Heavily used: Card, Button, Dialog, Sheet, Input, Tabs. Custom: schedule-view (998 lines), task-manager, master-input, calendars-sidebar.

## What is bad about the current surface

- Reads as generic productivity-SaaS dark mode. First-order category reflex.
- Card-everywhere layout. Stat pills are the hero-metric template at small scale.
- Hierarchy is flat. The schedule does not dominate the way "schedule-first" demands.
- Iconography is shadcn-default; no instrumentation feel.
- Background gradient on body is decorative, not functional.

## Constraints the overhaul must preserve

- Same Next.js + Tailwind + shadcn baseline (do not migrate frameworks).
- Same authenticated page surface and component contracts (props, types).
- Stable control dimensions (no layout shift on refresh).
- Real data only; honest empty states.
- Icon-first repeated controls.
