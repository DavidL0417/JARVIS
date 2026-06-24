"use client"

import { useEffect, useState } from "react"

import { DashboardPreview } from "@/components/landing/dashboard-preview"
import { WaitlistForm } from "@/components/landing/waitlist-form"

const HERO_SUBHEAD =
  "The reading is in Canvas. A reply you owe is buried in Gmail. Half a plan sits in Notion. None of them talk to each other, so you do — in your head, at 1am, hoping you didn't forget the one that actually mattered."

const SOURCES = ["Canvas", "Gmail", "Notion", "Google Calendar"]

export function LandingHero() {
  // CSS-driven entrance: render hidden, then flip one attribute on mount so every
  // piece transitions in (opacity/transform only). No library, nothing scroll-linked.
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduced) {
      setShown(true)
      return
    }
    const raf = window.requestAnimationFrame(() => setShown(true))
    const fallback = window.setTimeout(() => setShown(true), 1200)
    const onShow = () => setShown(true)
    window.addEventListener("pageshow", onShow)
    return () => {
      window.cancelAnimationFrame(raf)
      window.clearTimeout(fallback)
      window.removeEventListener("pageshow", onShow)
    }
  }, [])

  return (
    <div data-hero-in={shown} className="landing-hero relative min-h-[100svh] overflow-hidden">
      <div className="relative z-10 mx-auto flex min-h-[100svh] w-full max-w-[1200px] flex-col justify-center px-6 pb-[clamp(56px,8vh,104px)] pt-[calc(56px+clamp(28px,5vh,72px))] md:px-10">
        <div className="hero-layout">
          <div className="hero-copy-block flex flex-col">
            <p
              className="hero-reveal landing-mark flex items-center gap-2 text-[10.5px] text-muted-foreground"
              style={{ transitionDelay: "60ms" }}
            >
              <span aria-hidden="true" className="inline-flex items-center text-[var(--copper)]">
                <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                  <path d="M4.5 0v9M0 4.5h9" stroke="currentColor" strokeWidth="0.8" />
                </svg>
              </span>
              <span className="text-[var(--copper)]">01</span>
              <span aria-hidden="true">·</span>
              <span>the secretary that already knows</span>
            </p>

            <h1
              id="hero-heading"
              className="hero-reveal landing-display mt-5 max-w-[18ch] text-[clamp(2.4rem,6vw,4.8rem)] font-semibold leading-[0.95] text-foreground"
              style={{ transitionDelay: "150ms" }}
            >
              Stop holding your whole life{" "}
              <span data-intro-underline data-bloom-dim className="landing-keyword hero-keyword-reveal">
                in your head
              </span>
              .
            </h1>

            <p
              className="hero-reveal mt-8 max-w-[54ch] text-[clamp(1rem,1.4vw,1.125rem)] leading-[1.55] text-foreground/80"
              style={{ transitionDelay: "260ms" }}
            >
              {HERO_SUBHEAD}
            </p>

            <div className="hero-reveal mt-9 flex flex-col gap-3" style={{ transitionDelay: "360ms" }}>
              <WaitlistForm variant="compact" id="hero-waitlist" />
              <p className="landing-mark text-[10.5px] text-muted-foreground">
                Invites in order. No spam. No setup. It just knows.
              </p>
            </div>

            <div
              className="hero-reveal mt-9 flex flex-wrap items-center gap-2"
              style={{ transitionDelay: "440ms" }}
            >
              <span className="landing-mark mr-1 text-[10px] text-muted-foreground">connects to</span>
              {SOURCES.map((source) => (
                <span
                  key={source}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--rule)] bg-[var(--panel)]/60 px-2.5 py-1 text-[11.5px] text-foreground/80"
                >
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--copper)]" />
                  {source}
                </span>
              ))}
            </div>
          </div>

          <div className="hero-reveal hero-preview-stage" style={{ transitionDelay: "520ms" }}>
            <div className="hero-preview-frame relative">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -inset-5 -z-10 rounded-md"
                style={{
                  background:
                    "radial-gradient(65% 60% at 32% 38%, oklch(0.72 0.13 45 / 0.22), transparent 72%)",
                }}
              />
              <DashboardPreview />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
