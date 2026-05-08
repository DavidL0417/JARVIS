"use client"

import { useEffect, useRef, useState } from "react"

import { SignInLink } from "@/components/landing/sign-in-link"
import { useMagneticPull } from "@/hooks/use-magnetic-pull"

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false)
  const ctaRef = useRef<HTMLAnchorElement | null>(null)
  useMagneticPull(ctaRef, { strength: 0.18, radius: 80 })

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8)
    update()
    window.addEventListener("scroll", update, { passive: true })
    return () => window.removeEventListener("scroll", update)
  }, [])

  return (
    <header
      data-scrolled={scrolled}
      className="sticky top-0 z-30 flex h-14 items-center justify-between px-[var(--landing-px)] transition-colors"
      style={{
        backgroundColor: scrolled ? "color-mix(in oklab, var(--background) 88%, transparent)" : "transparent",
        backdropFilter: scrolled ? "blur(12px)" : "none",
        WebkitBackdropFilter: scrolled ? "blur(12px)" : "none",
        borderBottom: scrolled ? "1px solid var(--rule)" : "1px solid transparent",
      }}
    >
      <a
        href="#top"
        data-bloom-shield
        className="landing-display group inline-flex items-baseline gap-0.5 text-[16px] font-semibold leading-none text-foreground"
        style={{ letterSpacing: "-0.03em" }}
      >
        <span>Jarvis</span>
        <span
          className="inline-block h-1 w-1 translate-y-[-2px] rounded-full bg-[var(--copper)] transition-transform group-hover:scale-110"
          aria-hidden="true"
        />
      </a>

      <nav className="flex items-center gap-5">
        <SignInLink />
        <a
          ref={ctaRef}
          href="#waitlist"
          data-bloom-shield
          className="inline-flex h-8 items-center rounded-[2px] bg-[var(--copper)] px-3 text-[12px] font-medium tracking-tight text-[var(--primary-foreground)] shadow-[0_4px_18px_-6px_oklch(0.74_0.14_42_/_0.55)] transition-shadow hover:shadow-[0_6px_22px_-6px_oklch(0.74_0.14_42_/_0.7)]"
          style={{ willChange: "transform" }}
        >
          Join waitlist
        </a>
      </nav>
    </header>
  )
}
