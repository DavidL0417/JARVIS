import type { Metadata } from "next"

import { LandingFooter } from "@/components/landing/landing-footer"
import { LandingHero } from "@/components/landing/landing-hero"
import { LandingMotion } from "@/components/landing/landing-motion"
import { LandingNav } from "@/components/landing/landing-nav"
import { SectionReveal } from "@/components/landing/section-reveal"
import { WaitlistForm } from "@/components/landing/waitlist-form"

export const metadata: Metadata = {
  title: "Jarvis — A secretary that already knows everything",
  description:
    "Jarvis connects to your Gmail, Canvas, Notion, and every source you use — then decides what you should work on next. No thinking required. An autonomous secretary with full context.",
  openGraph: {
    title: "Jarvis — A secretary that already knows everything",
    description:
      "Connected to every source you use. Decides what you should do next so you never have to think about it.",
    type: "website",
  },
}

const steps = [
  {
    number: "01",
    title: "Connect everything you already use.",
    detail:
      "Gmail, Canvas, Notion, Google Calendar — Jarvis plugs into every source where your obligations live. No manual entry. It reads what you read.",
  },
  {
    number: "02",
    title: "Jarvis decides what matters next.",
    detail:
      "With full context across every source, it breaks obligations into concrete actions and schedules them. You don’t prioritize. It already knows.",
  },
  {
    number: "03",
    title: "You sit down and start. That’s it.",
    detail:
      "Open Jarvis and the first thing on screen is exactly what to do for the next 30–90 minutes. No planning, no thinking, no waiting.",
  },
]

const refrains = [
  "Not a system you have to build.",
  "Not an AI that needs you to tell it what to do.",
  "Not a chatbot pretending to know your life.",
  "A secretary that already knows everything.",
]

function SectionEyebrow({ index, label }: { index: string; label: string }) {
  return (
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
  )
}

export default function LandingPage() {
  return (
    <main
      id="top"
      className="landing relative min-h-screen overflow-hidden"
      style={
        {
          ["--landing-px" as string]: "clamp(20px, 5vw, 88px)",
        } as React.CSSProperties
      }
    >
      <span aria-hidden="true" className="landing-grain" />
      <LandingMotion />

      <LandingNav />

      <section
        id="section-hero"
        data-spine-section="hero"
        data-spine-index="01"
        data-spine-label="start"
        aria-labelledby="hero-heading"
        className="relative z-10 min-h-[100svh]"
      >
        <LandingHero />
      </section>

      <div className="relative z-10 pl-[var(--landing-px)] pr-[var(--landing-px)] md:pl-[calc(var(--landing-px)+72px)]">
        <div className="mx-auto w-full max-w-[1180px]">
          <SectionReveal as="section">
            <section
              id="section-problem"
              data-spine-section="problem"
              data-spine-index="02"
              data-spine-label="problem"
              className="stagger-leftright grid grid-cols-1 gap-[clamp(28px,4vw,56px)] py-[clamp(72px,10vw,140px)] md:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)]"
            >
              <div>
                <SectionEyebrow index="02" label="The real problem" />
                <h2 className="landing-display mt-4 max-w-[16ch] text-[clamp(1.8rem,3.6vw,2.8rem)] font-semibold leading-[1.04] text-foreground">
                  Your information is everywhere. Your brain shouldn&apos;t have to be.
                </h2>
              </div>
              <div className="space-y-5 text-[clamp(1rem,1.4vw,1.125rem)] leading-[1.6] text-foreground/80">
                <p>
                  Deadlines buried in Canvas. Meeting notes in Notion. Commitments scattered across Gmail threads.
                  You already have the information — it&apos;s just in twelve places, and your brain is the only
                  thing stitching it together.
                </p>
                <p>
                  Jarvis connects to every source you use and builds the full picture automatically. It doesn&apos;t
                  wait for you to check — it already knows what&apos;s due, what&apos;s changed, and what to do
                  about it. Like handing your entire life to a secretary who never drops a thread.
                </p>
              </div>
            </section>
          </SectionReveal>

          <hr className="border-t border-[var(--rule)]" aria-hidden="true" />

          <SectionReveal as="section">
            <section
              id="section-how"
              data-spine-section="how"
              data-spine-index="03"
              data-spine-label="how"
              className="py-[clamp(72px,10vw,140px)]"
            >
              <SectionEyebrow index="03" label="How it works" />
              <h2 className="landing-display mt-4 max-w-[20ch] text-[clamp(1.8rem,3.6vw,2.8rem)] font-semibold leading-[1.04] text-foreground">
                Three steps. Then you stop thinking about it.
              </h2>

              <ol className="stagger-children mt-[clamp(36px,5vw,64px)] divide-y divide-[var(--rule)]">
                {steps.map((step, index) => (
                  <li
                    key={step.number}
                    className="grid grid-cols-[auto_1fr] gap-x-[clamp(24px,5vw,72px)] gap-y-2 py-[clamp(28px,4vw,40px)] md:grid-cols-[120px_minmax(0,0.42fr)_minmax(0,0.58fr)]"
                  >
                    <span
                      className="landing-display num text-[clamp(1.8rem,3.5vw,2.6rem)] font-light leading-none text-[var(--copper)]"
                      aria-hidden="true"
                      style={{ letterSpacing: "-0.02em" }}
                    >
                      {step.number}
                    </span>
                    <h3 className="self-start max-w-[28ch] text-[clamp(1.1rem,1.8vw,1.35rem)] font-semibold leading-[1.25] text-foreground md:col-span-1">
                      {step.title}
                    </h3>
                    <p className="col-span-2 max-w-[58ch] text-[clamp(0.95rem,1.3vw,1.05rem)] leading-[1.6] text-foreground/70 md:col-span-1 md:col-start-3 md:row-start-1 md:self-start">
                      {step.detail}
                    </p>
                    <span className="sr-only">Step {index + 1} of {steps.length}.</span>
                  </li>
                ))}
              </ol>
            </section>
          </SectionReveal>

          <div
            aria-hidden="true"
            className="my-[clamp(40px,6vw,80px)] h-[1px] w-full"
            style={{
              background:
                "linear-gradient(to right, transparent, var(--copper) 18%, var(--copper-bright) 50%, var(--copper) 82%, transparent)",
            }}
          />

          <SectionReveal as="section">
            <section
              id="section-not"
              data-spine-section="not"
              data-spine-index="04"
              data-spine-label="not"
              className="py-[clamp(56px,8vw,100px)]"
            >
              <SectionEyebrow index="04" label="What it isn&rsquo;t" />
              <ul className="stagger-children landing-display mt-6 max-w-[40ch] space-y-2 text-[clamp(1.5rem,3vw,2.4rem)] font-semibold leading-[1.12] text-foreground">
                {refrains.map((line, index) => (
                  <li
                    key={line}
                    className={index === refrains.length - 1 ? "text-foreground" : "text-foreground/35"}
                  >
                    {line}
                  </li>
                ))}
              </ul>
            </section>
          </SectionReveal>

          <SectionReveal as="section">
            <section
              id="section-cta"
              data-spine-section="cta"
              data-spine-index="05"
              data-spine-label="early access"
              className="grid grid-cols-1 items-end gap-[clamp(24px,4vw,56px)] border-t border-[var(--rule)] py-[clamp(80px,11vw,160px)] md:grid-cols-[minmax(0,0.55fr)_minmax(0,0.45fr)]"
            >
              <div id="waitlist" className="scroll-mt-24">
                <SectionEyebrow index="05" label="Early access · hand-built" />
                <h2 className="landing-final-phrase landing-display mt-4 max-w-[18ch] text-[clamp(2rem,4.4vw,3.4rem)] font-semibold leading-[1.0] text-foreground">
                  Stop thinking. <span className="cta-accent-phrase">Start doing.</span>
                </h2>
                <p className="mt-4 max-w-[48ch] text-[clamp(1rem,1.4vw,1.125rem)] leading-[1.55] text-foreground/70">
                  Currently in super-early beta, so I'm hand-building the app for each individual. 
                  Any integration, any dashboard, any quirk, any UI feature you want. You name it, I build it.
                  Accessibly priced for a college student.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <WaitlistForm variant="anchor" id="anchor-waitlist" />
                <p className="landing-mark text-[10.5px] text-muted-foreground">
                  Invites in order · .edu preferred · custom config included
                </p>
              </div>
            </section>
          </SectionReveal>

          <LandingFooter />
        </div>
      </div>
    </main>
  )
}
