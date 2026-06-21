import Link from "next/link"
import type { ReactNode } from "react"

import { LandingFooter } from "@/components/landing/landing-footer"

const CONTAINER = "mx-auto w-full max-w-[760px] px-6 md:px-8"

export function LegalShell({
  title,
  lastUpdated,
  intro,
  children,
}: {
  title: string
  lastUpdated: string
  intro?: ReactNode
  children: ReactNode
}) {
  return (
    <main className="relative min-h-screen">
      <header className="sticky top-0 z-30 h-14 border-b border-[var(--rule)] bg-[color-mix(in_oklab,var(--background)_88%,transparent)] backdrop-blur-md">
        <div className={`flex h-full items-center justify-between ${CONTAINER}`}>
          <Link
            href="/"
            className="landing-display inline-flex items-baseline gap-0.5 text-[15px] font-semibold text-foreground"
            style={{ letterSpacing: "-0.03em" }}
          >
            <span>Jarvis</span>
            <span
              className="inline-block h-1 w-1 translate-y-[-2px] rounded-full bg-[var(--copper)]"
              aria-hidden="true"
            />
          </Link>
          <Link
            href="/"
            className="text-[12.5px] text-muted-foreground transition-opacity hover:opacity-70"
          >
            ← Back home
          </Link>
        </div>
      </header>

      <div className={`${CONTAINER} pt-[clamp(40px,7vw,80px)]`}>
        <p className="landing-mark flex items-center gap-2 text-[10.5px] text-muted-foreground">
          <span className="text-[var(--copper)]">§</span>
          <span>Legal</span>
        </p>
        <h1 className="landing-display mt-4 text-[clamp(2rem,4.5vw,3rem)] font-semibold leading-[1.05] text-foreground">
          {title}
        </h1>
        <p className="num mt-3 text-[12.5px] uppercase tracking-[0.12em] text-muted-foreground">
          Last updated {lastUpdated}
        </p>
        {intro ? (
          <div className="mt-8 space-y-4 text-[15px] leading-[1.7] text-foreground/80">{intro}</div>
        ) : null}

        <div className="mt-10 space-y-10">{children}</div>
      </div>

      <div className={CONTAINER}>
        <LandingFooter />
      </div>
    </main>
  )
}

export function LegalSection({
  id,
  heading,
  children,
}: {
  id?: string
  heading: string
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-[var(--rule)] pt-8">
      <h2 className="landing-display text-[clamp(1.15rem,2vw,1.5rem)] font-semibold leading-[1.2] text-foreground">
        {heading}
      </h2>
      <div className="mt-4 space-y-4 text-[15px] leading-[1.7] text-foreground/80">{children}</div>
    </section>
  )
}

export function LegalList({ items }: { items: { label?: string; body: ReactNode }[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.label ?? String(item.body)} className="relative pl-5">
          <span
            className="absolute left-0 top-[0.62em] h-[5px] w-[5px] rotate-45 bg-[var(--copper)]"
            aria-hidden="true"
          />
          {item.label ? <span className="font-medium text-foreground">{item.label} </span> : null}
          {item.body}
        </li>
      ))}
    </ul>
  )
}

export function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-foreground underline decoration-[var(--copper)] underline-offset-2 transition-opacity hover:opacity-70"
    >
      {children}
    </a>
  )
}
