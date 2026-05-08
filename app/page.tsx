import type { Metadata } from "next"

import { CursorSpotlight } from "@/components/landing/cursor-spotlight"
import { DashboardPreview } from "@/components/landing/dashboard-preview"
import { LandingFooter } from "@/components/landing/landing-footer"
import { LandingHero } from "@/components/landing/landing-hero"
import { LandingNav } from "@/components/landing/landing-nav"
import { SectionReveal } from "@/components/landing/section-reveal"
import { TimeSpine } from "@/components/landing/time-spine"
import { WaitlistForm } from "@/components/landing/waitlist-form"

export const metadata: Metadata = {
  title: "Jarvis — Sit down and know exactly what to start",
  description:
    "Jarvis pulls deadlines from your Canvas and syllabi, breaks them into the next concrete action, and surfaces them two weeks before crunch. No system to build, no AI hijacking your day.",
  openGraph: {
    title: "Jarvis — Sit down and know exactly what to start",
    description:
      "Pulled from your Canvas and syllabi, broken into the next concrete action, surfaced two weeks before crunch.",
    type: "website",
  },
}

const steps = [
  {
    number: "01",
    title: "Connect Canvas and your syllabi.",
    detail:
      "Drop in the syllabus PDFs you already have. Jarvis pulls deadlines, weights, and quiet expectations the LMS won't show you.",
  },
  {
    number: "02",
    title: "Jarvis surfaces what's coming, two weeks early.",
    detail:
      "Every deadline is broken into a concrete next action and dropped onto a real schedule, not a list of vague intentions.",
  },
  {
    number: "03",
    title: "Sit down knowing what to start.",
    detail:
      "Open Jarvis and the first thing on screen is the next 30-90 minutes. Approve, revise, or skip. No ceremony.",
  },
]

const refrains = [
  "Not a system to build like Notion.",
  "Not an AI hijacking your day like Motion.",
  "Not a chatbot pretending to be your therapist.",
  "A schedule, surfaced honestly.",
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
      <CursorSpotlight />

      <TimeSpine />
      <LandingNav />

      <div className="relative z-10 pl-[var(--landing-px)] pr-[var(--landing-px)] md:pl-[calc(var(--landing-px)+72px)]">
        <div className="mx-auto w-full max-w-[1180px]">
          <section
            id="section-hero"
            data-spine-section="hero"
            data-spine-index="01"
            data-spine-label="start"
            aria-labelledby="hero-heading"
            className="relative grid grid-cols-1 gap-[clamp(40px,7vw,84px)] pb-[clamp(60px,9vw,120px)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-end"
          >
            <div className="lg:col-span-2">
              <LandingHero />
            </div>
            <div className="lg:col-span-2 lg:-mt-6">
              <SectionReveal oneShot>
                <div className="ml-auto w-full max-w-[940px] pl-0 lg:pl-[clamp(40px,8vw,140px)]">
                  <div className="relative">
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute -inset-4 -z-10 rounded-md"
                      style={{
                        background:
                          "radial-gradient(60% 60% at 30% 40%, oklch(0.74 0.14 42 / 0.18), transparent 70%)",
                      }}
                    />
                    <DashboardPreview />
                    <p className="mt-3 max-w-[44ch] pl-1 text-[12px] leading-snug text-muted-foreground">
                      A quiet day. The dominant surface is the schedule. Everything else is supporting context arranged
                      around it.
                    </p>
                  </div>
                </div>
              </SectionReveal>
            </div>
          </section>

          <hr className="border-t border-[var(--rule)]" aria-hidden="true" />

          <SectionReveal as="section">
            <section
              id="section-problem"
              data-spine-section="problem"
              data-spine-index="02"
              data-spine-label="problem"
              className="stagger-leftright grid grid-cols-1 gap-[clamp(28px,4vw,56px)] py-[clamp(72px,10vw,140px)] md:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)]"
            >
              <div>
                <SectionEyebrow index="02" label="The avoidable failure" />
                <h2 className="landing-display mt-4 max-w-[16ch] text-[clamp(1.8rem,3.6vw,2.8rem)] font-semibold leading-[1.04] text-foreground">
                  You sat down on Sunday with three weeks of unread Canvas posts.
                </h2>
              </div>
              <div className="space-y-5 text-[clamp(1rem,1.4vw,1.125rem)] leading-[1.6] text-foreground/80">
                <p>
                  A syllabus you skimmed in week one. A vague feeling that something was due. By the time you found
                  it, the cushion was gone, the office hours had already happened, and the work that would&apos;ve
                  been ninety minutes on Wednesday was now four panicked hours on Thursday night.
                </p>
                <p>
                  Jarvis is not for the people who have a system. It&apos;s for the people who&apos;ve felt the gap
                  between their tools knowing what&apos;s coming and them knowing what to start, today.
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
                Three steps. None of them require a setup weekend.
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
                <SectionEyebrow index="05" label="Early access" />
                <h2 className="landing-display mt-4 max-w-[18ch] text-[clamp(2rem,4.4vw,3.4rem)] font-semibold leading-[1.0] text-foreground">
                  Stop guessing what to start next.
                </h2>
                <p className="mt-4 max-w-[44ch] text-[clamp(1rem,1.4vw,1.125rem)] leading-[1.55] text-foreground/70">
                  Jarvis is invite-only while it stabilizes. Drop your school email and you&apos;ll hear when your
                  spot comes up.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <WaitlistForm variant="anchor" id="anchor-waitlist" />
                <p className="landing-mark text-[10.5px] text-muted-foreground">
                  Invites in order. No spam. .edu preferred but not required.
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
