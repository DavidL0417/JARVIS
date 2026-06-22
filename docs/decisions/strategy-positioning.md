# Strategy & Positioning

The standing reference for *where JARVIS is going and why*. Written 2026-06-21 after a competitive scan (Martin, Lindy) and a JTBD working session. Read this when the direction feels uneasy — the decisions below were made deliberately, not by default.

## The one-line thesis

JARVIS is **one assistant with an invisible breadth of sensors and exactly two surfaces a human ever touches**: a dashboard you go to (consolidation), and a text thread that comes to you (capture). The breadth is plumbing the user never sees; the depth is what that plumbing uniquely enables.

## The two jobs we are hired to do (JTBD)

From customer interviews, two problems were sharp enough to act on. We organize the product around these *jobs*, not around a feature list:

1. **Consolidation** — *"I'm tired of checking six apps to know what I owe."* Know everything you owe, in one place, without checking six tools.
2. **The capture gap** — *"Things I agreed to in a text or email never make it onto my calendar, and I miss them."* If it was said, it ends up on your calendar. Nothing you committed to slips.

Both jobs are about **intake and consolidation** — which is exactly where our moat lives. We sell the *progress the customer is trying to make*, not "an AI assistant."

## The competitive opening

- **Martin** (YC S23, ~$2M) — closest competitor, same lane (turnkey consumer assistant). Strong on the *channel model*: it reaches you where you already are (text/call), not behind an app icon. This validates our proactive-digest thesis. But it competes on **breadth-of-channel, not depth-of-context** — it knows your calendar and inbox, not your coursework, iMessage, or whether you actually did the thing.
- **Lindy** (~$50M) — different lane: a B2B no-code agent *builder* with a metered credit model (its #1 complaint). Mine it for features (draft→approve gate, templates), not positioning.

**Neither can see your text messages.** Only local Mac software can. That structural gap — *"the meeting your friend texted you about is now on your calendar, because JARVIS read the text"* — is a demo our competitors are incapable of, not just behind on. Staying grounded in job #2 produces the differentiation automatically; we never have to "copy Martin" or consciously avoid it.

## Architecture: one brain, sensors, surfaces

Three things that must stay conceptually separate. Confusion only arises when they get blended.

| Layer | What it is | User's relationship to it |
|---|---|---|
| **The brain** | One agent + context store + memory. Lives in the cloud. There is exactly one "JARVIS." | The product itself |
| **Sensors (intake)** | Mac companion (iMessage, Reminders), cloud connectors (Canvas, Gmail, Calendar, Notion). | **Invisible.** The user never "uses" a sensor; it feeds the brain. Breadth lives here and stays out of sight. |
| **Surfaces (interaction)** | The two places a human actually touches. | See below |

### The two surfaces each get exactly one job

| Surface | Its one job | Cadence |
|---|---|---|
| **Web dashboard** | The review desk / command center. Go here deliberately to see everything, approve, plan, configure. Serves the **consolidation** job. | Low frequency, high depth |
| **Text / call** | The nudge channel. JARVIS reaches *out*; you reply in one line. Serves the **capture** job. You never "manage" from here. | High frequency, low depth |
| **Mac companion** | Pure sensor (a menu-bar presence), eventually the brain. Invisible by design. | The user barely touches it |

This is the **email (the place you go) vs. notifications (the thing that reaches you)** model. Everyone already understands it; the user holds *two* things in their head, not seven. The surfaces map to different *moments* of different jobs, so they never compete:

- Capture is passive + reactive → a sensor catches it, it surfaces as a one-tap nudge in the **text channel**, job done there.
- Consolidation is deliberate → it happens when you sit down to plan → that's the **dashboard's** moment.

## Decided: do NOT collapse everything onto the Mac

The "if we're building the companion anyway, make it the whole app" instinct is elegant engineering and wrong for *this* product. Collapsing onto the Mac would cost us:

- **Every non-Mac user** — which is most of the future business segment (lawyers, office workers are Windows/phone-first).
- **"Reach you anywhere"** — a daemon can't text you with your laptop closed in a bag; a cloud service can. The proactive nudge *requires* an always-on hub that isn't the user's laptop.
- **Multi-user** — i.e. the business.

The hybrid (cloud brain + thin Mac sensor) looks like "more moving pieces," but those pieces *are* the value prop: **the local sensor buys depth, the cloud hub buys reach. The job needs both.** The all-on-Mac, no-companion build is a *different product* for the privacy-maximalist single user — valid someday, but it contradicts the dashboard + reach-anywhere + business-consumer direction. (This is what the old "secretary scheduler" CS-folder prototype was: real depth, no reach, no dashboard — a one-person power tool, not a product. We pull toward reach, not toward it.)

## Decided: hard-gate the student launch to Mac (the gate is self-removing up-market)

First, separate two claims that are easy to blend:

- **"The iMessage sensor is Mac-only"** — true and unavoidable. There is no iMessage cloud API; the only way to read texts is local access to the Messages database on a Mac. The technical premise is real, not assumed.
- **"The product is Mac-only"** — false. The brain, the web dashboard, and the SMS-reach channel are all cloud/web and platform-agnostic. A Windows user *can* use JARVIS; they're just missing one sensor. We are gating **one sensor**, not the company.

**The Mac requirement is segment-specific, and it dissolves on its own as we move up-market:**

| Segment | Key capture signal | Lives where | Needs the Mac app? |
|---|---|---|---|
| Students (now) | iMessage ("group project meets Thursday 3") | Local, Mac-only | **Yes — and that's fine** |
| Lawyers / office workers (later) | Slack, email, Teams | Cloud APIs | **No** |

So the Mac gate sits exactly on the beachhead and evaporates up-market — for enterprise the signals we care about are already cloud-reachable, and JARVIS becomes a pure cloud product for them (Mac optional). We never "remove" the requirement; it stops being relevant.

And the gate is a gift, not a compromise: **the one segment whose pain requires a Mac is the segment that already lives on Mac.** ~45% of US college students actually use a MacBook (2025); 71% use *or would prefer* Mac (Jamf). Mac-first for students is meeting them where they are, not excluding them.

**Decision: hard-gate the student launch to Mac** (must have a Mac, full stop), rather than soft-gating (anyone signs up, Mac users get the superpower). Reasons:

- The winning demo is *"your friend's text is now on your calendar."* Letting Windows students in early makes that demo fail for them and dilutes the one thing that differentiates us. Every early user should have the magic working 100% of the time.
- Sharper positioning: "the assistant that reads your texts" *requires* a Mac — a feature, not an apology.
- We soft-gate later, deliberately, when enterprise cloud signals make a web-only/Windows experience genuinely good rather than degraded.

**The load-bearing argument is the triad — keep it strong, don't lean on willingness-to-pay:**

1. The differentiated student pain (iMessage capture) is **technically** local-only.
2. The student segment **already** lives on Mac.
3. The Mac gate **dissolves** when we climb to cloud-native enterprise signals.

"Mac users pay more / Windows users won't spend $20" is a directionally-true tailwind (Mac ownership correlates with willingness to pay for premium software) — mention it in the room, but do not build the strategy on it. It's brittle and a sharp reviewer will poke it; the triad is airtight. Frame the whole thing as **"Mac is the correct gate for the beachhead, and it's self-removing up-market,"** not "we're stuck being Mac-only."

## Decided: student-first sequencing

We sequence **student-first** to validate demand and get off the ground. Students are the **sharpest, clearest pain** (Canvas deadlines, did-I-actually-do-it) and give us the interview pipeline.

The expansion path is clean because **every target segment shares the identical job** — only the stakes and willingness-to-pay change:

| Segment | The thing that slips | Stakes |
|---|---|---|
| Student (now) | A Canvas deadline | A failed assignment |
| Lawyer (later) | A client meeting | Real money |
| Office worker (later) | A 1:1 with the boss | Standing at work |
| "Would hire an assistant but doesn't want the overhead" | Anything committed | The whole pitch, verbatim |

**Same engine, same two jobs — we re-point the sensors at higher-value sources.** Not two products; one engine with a different connector set. Students prove the engine cheaply; the business segment is where the price is trivially justified.

## Pricing posture

- Target ~**$20/mo**. We acknowledge internally that the product is **genuinely expensive to run** (heavy LLM intake usage) — "cheap" is a marketing claim, not a cost reality. Margin is a real thing to watch.
- **The answer to the margin problem is the business segment, not squeezing students.** A missed client meeting dwarfs $20; a student's wallet does not. Expect a subsidized/cheaper student tier and a real-money professional tier on the same backend.
- Pricing is **flat and predictable** — explicitly *not* Lindy's metered credit model, which is its single biggest source of customer frustration. "No surprise bills" is itself a wedge.

## Features worth borrowing (and what to refuse)

- **Borrow:** channel-first reach (text thread as a primary surface), adaptive briefing, voice input (Martin); draft→approve gate (Lindy — we already have it via the risk-decisions rail), a *pre-built* student template gallery (not a blank canvas), meeting/lecture action-item extraction.
- **Refuse:** Lindy's credit metering (poison for students), Lindy's build-it-yourself config burden (students need turnkey — the agent self-configures from sources), Martin's shallow context (don't win on channels alone — that's the one thing Martin already does well).

## How to use this doc

When a build decision creates tension — another surface, a new channel, a pricing question, a "should we just put it all on the Mac" temptation — check it against:

1. Does it serve one of the **two jobs** (consolidation, capture)?
2. Does it keep the **two-surface / invisible-sensor** model intact, or does it add a third thing the user has to hold in their head?
3. Does it preserve **reach** (cloud hub) and the path to the **business segment**?
4. Is it **student-first** right now?

If it fails these, it's probably solution-thinking drifting away from the job. Come back here.
