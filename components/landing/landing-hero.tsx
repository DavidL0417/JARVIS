"use client"

import { useEffect, useRef } from "react"

import { WaitlistForm } from "@/components/landing/waitlist-form"

export function LandingHero() {
  const eyebrowRef = useRef<HTMLParagraphElement | null>(null)
  const headlineRef = useRef<HTMLHeadingElement | null>(null)
  const subheadRef = useRef<HTMLParagraphElement | null>(null)
  const formRef = useRef<HTMLDivElement | null>(null)
  const keywordRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const targets = [eyebrowRef.current, headlineRef.current, subheadRef.current, formRef.current].filter(
      Boolean,
    ) as HTMLElement[]
    const keyword = keywordRef.current

    if (reduced) {
      targets.forEach((el) => {
        el.style.opacity = "1"
        el.style.transform = "none"
      })
      if (keyword) {
        keyword.style.transform = "none"
        keyword.style.opacity = "1"
      }
      return
    }

    let cancelled = false
    void (async () => {
      const { eases, stagger, createTimeline } = await import("animejs")
      if (cancelled) return

      const tl = createTimeline({ defaults: { ease: eases.outExpo } })

      tl.add(
        targets,
        {
          opacity: [0, 1],
          translateY: [22, 0],
          duration: 800,
          delay: stagger(110, { start: 60 }),
        },
        0,
      )

      if (keyword) {
        tl.add(
          keyword,
          {
            "clip-path": ["inset(0 100% 0 0)", "inset(0 0% 0 0)"],
            opacity: [0, 1],
            duration: 720,
            ease: eases.outExpo,
          },
          440,
        )
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="landing-hero relative">
      <div className="relative z-10 flex flex-col gap-7 pt-[clamp(56px,9vw,128px)]">
        <p
          ref={eyebrowRef}
          className="landing-mark flex items-center gap-2 text-[10.5px] text-muted-foreground opacity-0"
        >
          <span aria-hidden="true" className="inline-flex items-center text-[var(--copper)]">
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
              <path d="M4.5 0v9M0 4.5h9" stroke="currentColor" strokeWidth="0.8" />
            </svg>
          </span>
          <span className="text-[var(--copper)]">01</span>
          <span aria-hidden="true">·</span>
          <span>For students who&apos;ve felt the friday-night gut drop</span>
        </p>

        <h1
          ref={headlineRef}
          className="landing-display max-w-[20ch] text-[clamp(2.6rem,8vw,6rem)] font-semibold leading-[0.96] text-foreground opacity-0"
        >
          Sit down and know{" "}
          <span
            ref={keywordRef}
            className="landing-keyword opacity-0"
            style={{ clipPath: "inset(0 100% 0 0)" }}
          >
            exactly what to start
          </span>
        </h1>

        <p
          ref={subheadRef}
          className="max-w-[52ch] text-[clamp(1.05rem,1.6vw,1.2rem)] leading-[1.5] text-foreground/75 opacity-0"
        >
          Pulled from your Canvas and syllabi, broken into the next concrete action, surfaced two weeks before crunch.
        </p>

        <div ref={formRef} className="flex flex-col gap-3 opacity-0">
          <WaitlistForm variant="compact" id="hero-waitlist" />
          <p className="landing-mark text-[10.5px] text-muted-foreground">
            Invites in order. No spam. No Notion to build, no AI hijacking your day.
          </p>
        </div>
      </div>
    </div>
  )
}
