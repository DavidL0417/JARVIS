import type { Metadata } from "next"

import { CapabilityList } from "@/components/landing/capability-list"
import { LandingFooter } from "@/components/landing/landing-footer"
import { LandingHero } from "@/components/landing/landing-hero"
import { LandingNav } from "@/components/landing/landing-nav"
import { Refrain } from "@/components/landing/refrain"
import { ScrollAmbient } from "@/components/landing/scroll-ambient"
import { SectionReveal } from "@/components/landing/section-reveal"
import { WaitlistForm } from "@/components/landing/waitlist-form"

export const metadata: Metadata = {
  title: "Jarvis — A secretary that already knows everything",
  description:
    "Stop holding your whole life in your head. Jarvis reads your Canvas, Gmail, Notion, and calendar, then hands you the next thing to do — so you can stop bracing for what you forgot.",
  openGraph: {
    title: "Jarvis — A secretary that already knows everything",
    description:
      "Stop holding your whole life in your head. Jarvis reads everything you already use and hands you the next thing to do.",
    type: "website",
  },
}

const progressHeading = "Imagine not being the one who has to remember."

const progressLines = [
  { k: "01", t: "A night out with friends, with nothing humming in the back of your head." },
  { k: "02", t: "Sunday nights without the dread, because Monday is already mapped." },
  { k: "03", t: "The thing due Friday, done by Thursday — because something was watching the calendar." },
  { k: "04", t: "You stop being the app that has to run all your other apps." },
]

// 03 — most days: the quiet background competence (rendered as toggles)
const everydayHeading = "Most of the time, you won't notice it."
const everydayLede =
  "The quiet, unglamorous work — handled in the background, before it ever becomes your problem."

const everydayCapabilities = [
  {
    number: "01",
    title: "Reads everything you already use.",
    detail:
      "Canvas, Gmail, Notion, GCal, iMessages, Reminders, etc. — all pulled into one place and kept current, without you asking.",
    body:
      "Anyone can sync calendars and deadlines. But Jarvis, like a true secretary, holds the other context too — the opportunities you texted in passing to friends, your half-formed reminders, your regrade requests to professors — so it understands the full picture, never a to-do list.",
  },
  {
    number: "02",
    title: "Builds the whole picture.",
    detail:
      "Every deadline, every thread, every change, connected — so nothing important is hiding in an app you forgot to open.",
    body:
      "Most tools keep your information in separate boxes. Jarvis connects them, so one change quietly updates everything it touches — including things you'd never think to link yourself.",
    example: {
      label: "For example",
      lines: [
        "Your professor emails that the midterm's been moved to a hall across campus.",
        "Jarvis checks it against your schedule and catches what you wouldn't: your 11am class lets out ten minutes before, on the far side of campus. It flags that you won't make it in time — a week out, not at 10:55.",
      ],
    },
  },
]

// 04 — when it counts: the agentic peak, shown open (not a toggle)
const momentHeading = "And when it counts, it's already there."
const momentLede =
  "When something big lands, it reads the situation, figures out what it affects, and hands you a plan with the tradeoffs already laid out — the decision stays yours, but the thinking is done."
const momentScenario = [
  "A friend texts: his mom passed. The funeral's next weekend, a few hours away.",
  "Before you've even worked out what to say back, Jarvis has mapped what going means — leave Friday, back Sunday, which runs into the problem set due that night and your Saturday shift.",
  "So it builds the whole plan and has it waiting: the email to your professor pushing the deadline, the message asking a coworker to cover Saturday's shift, your to-do list reshuffled and Monday's midterm prep protected, the travel time already on your calendar. It even reminds you to iron your shirts beforehand.",
  "Everything accounted for — nothing sent without you — so you understand each trade-off, approve what fits, and change what doesn't.",
  "You didn't plan any of it. You just got to be there for your friend.",
]

const refrains = [
  "Not another app to keep up with.",
  "Not an AI you have to manage.",
  "Not a chatbot guessing at your life.",
  "A secretary that already knows everything.",
]

const ctaCopy =
  "Jarvis is in super-early beta, so right now I hand-build it around each person. Any integration, any view, any quirk you want — tell me and I'll build it. Priced for a student budget."

const CONTAINER = "mx-auto w-full max-w-[1200px] px-6 md:px-10"

function SectionHead({ index, label, meta }: { index: string; label: string; meta?: string }) {
  return (
    <div className="flex items-center gap-4">
      <p className="landing-mark flex items-center gap-2 text-[10.5px] text-muted-foreground">
        <span aria-hidden="true" className="landing-eyebrow-mark">
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
            <path d="M4.5 0v9M0 4.5h9" stroke="currentColor" strokeWidth="0.8" />
          </svg>
        </span>
        <span className="text-[var(--copper)]">{index}</span>
        <span aria-hidden="true">·</span>
        <span>{label}</span>
      </p>
      <span aria-hidden="true" className="h-px flex-1 bg-[var(--rule)]" />
      {meta ? (
        <span className="landing-mark num hidden text-[10px] text-muted-foreground sm:inline">
          {meta}
        </span>
      ) : null}
    </div>
  )
}

export default function LandingPage() {
  return (
    <main id="top" className="landing relative min-h-screen overflow-hidden">
      <ScrollAmbient />

      <LandingNav />

      <section id="section-hero" aria-labelledby="hero-heading" className="relative z-10 min-h-[100svh]">
        <LandingHero />
      </section>

      <div className="relative z-10">
        {/* 02 — The progress (magnetism / the after) */}
        <SectionReveal as="section">
          <section id="section-progress" className="border-t border-[var(--rule)] py-[clamp(56px,7vw,104px)]">
            <div className={CONTAINER}>
              <SectionHead index="02" label="what changes" meta="the payoff" />
              <h2 className="landing-display mt-[clamp(28px,4vw,56px)] max-w-[20ch] text-[clamp(1.9rem,3.8vw,3rem)] font-semibold leading-[1.04] text-foreground">
                {progressHeading}
              </h2>

              <ul className="mt-[clamp(32px,4vw,56px)] grid grid-cols-1 gap-px overflow-hidden rounded-sm bg-[var(--rule)] sm:grid-cols-2 lg:grid-cols-4">
                {progressLines.map((line) => (
                  <li
                    key={line.k}
                    className="flex flex-col gap-5 bg-[var(--panel)] p-[clamp(20px,2.2vw,30px)]"
                  >
                    <div className="flex items-center justify-between">
                      <span className="landing-mark num text-[11px] text-[var(--copper)]">{line.k}</span>
                      <span aria-hidden="true" className="h-[7px] w-[7px] rotate-45 bg-[var(--copper)]" />
                    </div>
                    <span className="text-[clamp(1rem,1.25vw,1.15rem)] font-medium leading-[1.4] text-foreground/90">
                      {line.t}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </SectionReveal>

        {/* 03 — Most days: quiet background competence (reads + builds; toggles) */}
        <SectionReveal as="section">
          <section id="section-does" className="border-t border-[var(--rule)] py-[clamp(56px,7vw,104px)]">
            <div className={CONTAINER}>
              <SectionHead index="03" label="most days" meta="quiet" />
              <h2 className="landing-display mt-[clamp(24px,3vw,44px)] max-w-[18ch] text-[clamp(1.9rem,3.8vw,3rem)] font-semibold leading-[1.04] text-foreground">
                {everydayHeading}
              </h2>
              <p className="mt-5 max-w-[52ch] text-[clamp(1rem,1.3vw,1.125rem)] leading-[1.55] text-foreground/70">
                {everydayLede}
              </p>

              <CapabilityList items={everydayCapabilities} />
            </div>
          </section>
        </SectionReveal>

        {/* 04 — When it counts: the agentic peak, funeral shown open (not a toggle) */}
        <SectionReveal as="section">
          <section id="section-moment" className="border-t border-[var(--rule)] py-[clamp(64px,8vw,124px)]">
            <div className={CONTAINER}>
              <SectionHead index="04" label="when it counts" meta="the moment" />
              <h2 className="landing-display mt-[clamp(28px,4vw,56px)] max-w-[16ch] text-[clamp(2.1rem,4.4vw,3.4rem)] font-semibold leading-[1.02] text-foreground">
                {momentHeading}
              </h2>
              <p className="mt-5 max-w-[58ch] text-[clamp(1.05rem,1.4vw,1.2rem)] leading-[1.55] text-foreground/75">
                {momentLede}
              </p>

              <div className="mt-[clamp(36px,5vw,64px)] max-w-[760px] rounded-sm bg-[var(--panel)]/60 p-[clamp(24px,4vw,52px)]">
                <div className="space-y-[clamp(16px,2.4vw,26px)]">
                  {momentScenario.map((line, i) => {
                    const isLast = i === momentScenario.length - 1
                    if (isLast) {
                      return (
                        <p
                          key={i}
                          className="landing-display border-t border-[var(--rule)] pt-[clamp(16px,2.4vw,26px)] text-[clamp(1.4rem,2.6vw,2.1rem)] font-semibold leading-[1.15] text-foreground"
                        >
                          {line}
                        </p>
                      )
                    }
                    return (
                      <p
                        key={i}
                        className={
                          i === 0
                            ? "text-[clamp(1.15rem,1.9vw,1.5rem)] font-medium leading-[1.4] text-foreground"
                            : "max-w-[64ch] text-[clamp(1rem,1.3vw,1.12rem)] leading-[1.65] text-foreground/75"
                        }
                      >
                        {line}
                      </p>
                    )
                  })}
                </div>
              </div>
            </div>
          </section>
        </SectionReveal>

        {/* 05 — What it isn't (anxiety reduction) — scroll fade-in */}
        <SectionReveal as="section">
          <section id="section-not" className="border-t border-[var(--rule)] py-[clamp(56px,7vw,104px)]">
            <div className={CONTAINER}>
              <SectionHead index="05" label="what it isn&rsquo;t" meta="no catch" />
              <div className="mt-[clamp(28px,4vw,56px)] grid grid-cols-1 gap-[clamp(20px,4vw,56px)] lg:grid-cols-12">
                <div className="lg:col-span-8">
                  <Refrain lines={refrains} />
                </div>
                <p className="self-center text-[clamp(0.95rem,1.2vw,1.05rem)] leading-[1.55] text-muted-foreground lg:col-span-4">
                  It doesn&rsquo;t wait for instructions or hand you a blank chat box to fill in. It already
                  knows your week — you just decide what to act on.
                </p>
              </div>
            </div>
          </section>
        </SectionReveal>

        {/* 06 — Early access */}
        <SectionReveal as="section">
          <section id="section-cta" className="border-t border-[var(--rule)] py-[clamp(72px,9vw,140px)]">
            <div className={CONTAINER}>
              <SectionHead index="06" label="early access · hand-built" meta="join" />
              <div className="mt-[clamp(28px,4vw,56px)] grid grid-cols-1 items-end gap-[clamp(32px,5vw,72px)] lg:grid-cols-12">
                <div id="waitlist" className="scroll-mt-24 lg:col-span-7">
                  <h2 className="landing-final-phrase landing-display max-w-[16ch] text-[clamp(2.2rem,5vw,3.8rem)] font-semibold leading-[1.0] text-foreground">
                    Stop being the one who <span className="cta-accent-phrase">remembers</span>.
                  </h2>
                  <p className="mt-5 max-w-[46ch] text-[clamp(1rem,1.3vw,1.125rem)] leading-[1.55] text-foreground/70">
                    {ctaCopy}
                  </p>
                </div>
                <div className="flex flex-col gap-3 lg:col-span-5">
                  <WaitlistForm variant="anchor" id="anchor-waitlist" />
                  <p className="landing-mark text-[10.5px] text-muted-foreground">
                    Invites in order · .edu preferred · built around you
                  </p>
                </div>
              </div>

              <LandingFooter />
            </div>
          </section>
        </SectionReveal>
      </div>
    </main>
  )
}
