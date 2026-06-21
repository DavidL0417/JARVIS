import type { Metadata } from "next"

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

const problemHeading =
  "It's not that you're behind. It's that you're the only thing holding it together."

const problemCopy = [
  "The reading is in Canvas. A reply you owe is buried in Gmail. Half a plan sits in Notion. None of them talk to each other, so you do — in your head, at 1am, hoping you didn't forget the one that actually mattered.",
  "That dread of what-am-I-missing is what happens when a dozen apps force you to connect them together.",
]

const progressHeading = "Imagine not being the one who has to remember."

const progressLines = [
  { k: "01", t: "A night out with friends, with nothing humming in the back of your head." },
  { k: "02", t: "Sunday nights without the dread, because Monday is already mapped." },
  { k: "03", t: "The thing due Friday, done by Thursday — because something was watching the calendar." },
  { k: "04", t: "You stop being the app that has to run all your other apps." },
]

const howHeading = "You don't set it up. It sets itself up."

const steps = [
  {
    number: "01",
    title: "Connect what you already use.",
    detail:
      "Canvas, Gmail, Notion, Google Calendar — Jarvis plugs into wherever your obligations already live. Minimal setup, zero overhead.",
  },
  {
    number: "02",
    title: "It builds the whole picture.",
    detail:
      "Every deadline, every thread, every change — pulled together and kept current without you asking. It reads what you'd otherwise have to read yourself.",
  },
  {
    number: "03",
    title: "You just start.",
    detail:
      "Open Jarvis and the next 30–90 minutes are already decided. No planning, no triage, no staring at a blank list wondering where to begin.",
  },
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
        {/* 02 — The struggling moment (push) */}
        <SectionReveal as="section">
          <section id="section-problem" className="border-t border-[var(--rule)] py-[clamp(56px,7vw,104px)]">
            <div className={CONTAINER}>
              <SectionHead index="02" label="the part no one sees" meta="the struggle" />
              <div className="mt-[clamp(28px,4vw,56px)] grid grid-cols-1 gap-[clamp(24px,4vw,56px)] lg:grid-cols-12">
                <h2 className="landing-display text-[clamp(1.9rem,3.8vw,3rem)] font-semibold leading-[1.05] text-foreground lg:col-span-7">
                  {problemHeading}
                </h2>
                <div className="space-y-5 text-[clamp(1rem,1.3vw,1.125rem)] leading-[1.6] text-foreground/80 lg:col-span-5">
                  {problemCopy.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </SectionReveal>

        {/* 03 — The progress (magnetism / the after) */}
        <SectionReveal as="section">
          <section id="section-progress" className="border-t border-[var(--rule)] py-[clamp(56px,7vw,104px)]">
            <div className={CONTAINER}>
              <SectionHead index="03" label="what changes" meta="the payoff" />
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

        {/* 04 — How it works */}
        <SectionReveal as="section">
          <section id="section-how" className="border-t border-[var(--rule)] py-[clamp(56px,7vw,104px)]">
            <div className={CONTAINER}>
              <SectionHead index="04" label="how it works" meta="3 steps" />
              <h2 className="landing-display mt-[clamp(24px,3vw,44px)] max-w-[22ch] text-[clamp(1.9rem,3.8vw,3rem)] font-semibold leading-[1.04] text-foreground">
                {howHeading}
              </h2>

              <ol className="mt-[clamp(32px,4vw,56px)] divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
                {steps.map((step) => (
                  <li
                    key={step.number}
                    className="grid grid-cols-[auto_1fr] gap-x-[clamp(20px,4vw,64px)] gap-y-2 py-[clamp(24px,3vw,36px)] md:grid-cols-[110px_minmax(0,5fr)_minmax(0,7fr)]"
                  >
                    <span
                      className="landing-display num text-[clamp(1.8rem,3.2vw,2.6rem)] font-light leading-none text-[var(--copper)]"
                      aria-hidden="true"
                      style={{ letterSpacing: "-0.02em" }}
                    >
                      {step.number}
                    </span>
                    <h3 className="max-w-[24ch] self-center text-[clamp(1.1rem,1.7vw,1.4rem)] font-semibold leading-[1.2] text-foreground">
                      {step.title}
                    </h3>
                    <p className="col-span-2 max-w-[60ch] text-[clamp(0.95rem,1.25vw,1.05rem)] leading-[1.6] text-foreground/70 md:col-span-1 md:col-start-3 md:row-start-1 md:self-center">
                      {step.detail}
                    </p>
                  </li>
                ))}
              </ol>
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
                  No dashboards to maintain, no prompts to write. You connect your accounts once and it
                  runs in the background — the way a real assistant would.
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
