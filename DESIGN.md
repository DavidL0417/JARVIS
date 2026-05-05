# Design

## Overview

JARVIS uses a restrained product system for a late-night planning surface, plus a brief public signed-out landing page. The visual lane is Notion Calendar plus Arc: quiet surfaces, spatial clarity, a strong workbench, and a little controlled personality without drifting into generic SaaS gloss.

## Theme

Primary scene: a focused student planning tomorrow late at night on a laptop in a dim room, trying to preserve sleep and commitments while reducing uncertainty. This forces a dark, low-glare interface with tinted neutrals, careful contrast, compact controls, and rare color.

## Color

Color strategy: Restrained for the app, with a slightly more committed landing hero accent. Use OKLCH tokens only for system colors.

- Background: deep ink neutral, lightly tinted toward violet.
- Surface: two elevation steps above background for rails, panels, popovers, and schedule lanes.
- Text: warm near-white foreground, quieter muted foreground for labels and secondary status.
- Primary: restrained ember for the main planning action and selected controls.
- Semantic: separate OKLCH roles for success, warning, destructive, and info.
- Calendar colors: user-supplied colors may remain hex because they are data, not system tokens.

Avoid pure black, pure white, generic blue CTAs, decorative transparency, gradient text, and repeated color accents on inactive elements.

## Typography

Use the existing Geist/system sans stack for product consistency. Keep a compact fixed type scale for the app:

- 11px to 12px for utility labels.
- 13px to 14px for dense controls and task rows.
- 16px to 20px for panel headings and schedule dates.
- 40px to 64px only on the signed-out landing headline.

Use weight, space, and color to establish hierarchy. Do not use display fonts inside product controls.

## Layout

Authenticated shell:

- Left utility rail: narrow, icon-first navigation and global actions.
- Center workbench: schedule first, with adaptive timeline density and explicit empty/loading/error states.
- Right rail: command input, inline onboarding, task queue, source/memory status, and check-ins.

Signed-out landing:

- One viewport-led page with brand, value proposition, sign-in action, and a compact schematic product preview.
- Hint at the product below the first fold on desktop and mobile.

Spacing uses a 4px base rhythm with varied gaps for hierarchy. Cards are reserved for distinct interactive units, not page sections. Nested cards are not allowed.

## Components

- Buttons: compact, rectangular, icon-first where repeated; text labels only for primary or ambiguous actions.
- Inputs: visible labels for setup and preference fields; placeholders only show examples.
- Schedule blocks: stable dimensions, readable title, source/lock/priority affordances when available.
- Empty states: brief explanation plus a direct real action.
- Popovers and dialogs: use only when inline disclosure is insufficient.

Every interactive component needs default, hover, focus-visible, active, disabled, loading, error, and success treatment where applicable.

## Motion

Motion is functional and brief: 150ms to 220ms, ease-out, no layout-property animation, no page-load choreography in the app. The landing page may use subtle reveal timing, but it must not delay sign-in.
