"use client"

import type { ReactNode } from "react"
import { CalendarCheck2, LockKeyhole, Route, Sparkles } from "lucide-react"

interface LandingPageProps {
  authControls: ReactNode
}

function PreviewBlock({
  title,
  meta,
  tone = "neutral",
}: {
  title: string
  meta: string
  tone?: "neutral" | "primary" | "success" | "warning"
}) {
  const toneClass =
    tone === "primary"
      ? "border-primary/40 bg-primary/10 text-foreground"
      : tone === "success"
        ? "border-success/35 bg-success/10 text-foreground"
      : tone === "warning"
          ? "border-warning/35 bg-warning/10 text-foreground"
          : "border-border bg-surface-raised text-foreground"

  return (
    <div className={`rounded-md border px-3 py-2 ${toneClass}`}>
      <p className="truncate text-xs font-semibold">{title}</p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground">{meta}</p>
    </div>
  )
}

function ProductPreview() {
  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-card p-3 shadow-2xl">
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Tomorrow
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">Plan workbench</p>
        </div>
        <div className="rounded-md border border-primary/35 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
          Ready to plan
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(14rem,0.75fr)]">
        <div className="relative min-w-0 rounded-md border border-border bg-background/60 p-3">
          <div className="mb-2 grid grid-cols-[3rem_repeat(3,minmax(0,1fr))] gap-px text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <span />
            <span>Mon</span>
            <span>Tue</span>
            <span>Wed</span>
          </div>
          <div className="grid grid-cols-[3rem_repeat(3,minmax(0,1fr))] gap-px">
            {["8", "10", "12", "2", "4", "6"].map((hour) => (
              <div key={hour} className="contents">
                <div className="pr-2 pt-1 text-right text-[10px] text-muted-foreground">{hour}</div>
                <div className="min-h-11 border-t border-border/70 bg-surface-subtle" />
                <div className="min-h-11 border-t border-border/70 bg-surface-subtle" />
                <div className="min-h-11 border-t border-border/70 bg-surface-subtle" />
              </div>
            ))}
          </div>
          <div className="pointer-events-none absolute left-[42%] top-[4.1rem] hidden w-[34%] rounded-md border border-info/35 bg-info/10 px-2 py-1.5 text-[10px] font-semibold text-foreground sm:block">
            Fixed calendar
          </div>
          <div className="pointer-events-none absolute left-[57%] top-[7.35rem] hidden w-[32%] rounded-md border border-primary/45 bg-primary/15 px-2 py-1.5 text-[10px] font-semibold text-foreground sm:block">
            Focus block
          </div>
        </div>

        <div className="space-y-3">
          <PreviewBlock title="Inputs checked" meta="Calendar, tasks, memory, sources" tone="success" />
          <PreviewBlock title="Tradeoff note" meta="Protect sleep. Move reading before lunch." tone="warning" />
          <PreviewBlock title="Command" meta="Tell JARVIS what changed" tone="primary" />
        </div>
      </div>
    </div>
  )
}

export function LandingPage({ authControls }: LandingPageProps) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-[1180px] flex-col px-5 py-5 sm:px-8">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-md border border-border bg-card">
              <Sparkles className="size-4 text-primary" aria-hidden="true" />
            </div>
            <span className="text-sm font-semibold tracking-tight">JARVIS</span>
          </div>
          <div className="shrink-0">{authControls}</div>
        </header>

        <section className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(28rem,1.1fr)] lg:py-16">
          <div className="max-w-2xl">
            <p className="mb-5 inline-flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <LockKeyhole className="size-3.5 text-primary" aria-hidden="true" />
              Real calendar. Real tasks.
            </p>
            <h1 className="text-5xl font-semibold leading-[0.98] tracking-tight text-foreground sm:text-6xl">
              A calmer way to decide what tomorrow can hold.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground">
              JARVIS turns tasks, calendar context, preferences, and memory into a schedule that names the tradeoffs before they surprise you.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
              {authControls}
              <p className="max-w-sm text-xs leading-5 text-muted-foreground">
                Sign in with Google to mirror calendar context into your private scheduler workspace.
              </p>
            </div>
            <div className="mt-9 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
              <div className="flex items-start gap-2">
                <CalendarCheck2 className="mt-0.5 size-4 text-info" aria-hidden="true" />
                <span>Keep commitments visible.</span>
              </div>
              <div className="flex items-start gap-2">
                <Route className="mt-0.5 size-4 text-primary" aria-hidden="true" />
                <span>Place focus work deliberately.</span>
              </div>
              <div className="flex items-start gap-2">
                <Sparkles className="mt-0.5 size-4 text-success" aria-hidden="true" />
                <span>Explain what changed.</span>
              </div>
            </div>
          </div>

          <div className="min-w-0">
            <ProductPreview />
          </div>
        </section>

        <section className="grid gap-3 border-t border-border py-5 text-sm text-muted-foreground sm:grid-cols-3">
          <p>Built for late-night planning, not busywork dashboards.</p>
          <p>Empty states stay honest. The app never invents work.</p>
          <p>Calendar writes and destructive actions require explicit approval.</p>
        </section>
      </div>
    </main>
  )
}
