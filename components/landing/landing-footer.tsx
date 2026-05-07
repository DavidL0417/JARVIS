import { LiveClock } from "@/components/landing/live-clock"

export function LandingFooter() {
  return (
    <footer className="mt-[clamp(96px,12vw,180px)] border-t border-[var(--rule)] pb-[clamp(28px,4vw,48px)] pt-[clamp(28px,4vw,52px)]">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-2">
          <span className="landing-display inline-flex items-baseline gap-0.5 text-[15px] font-semibold text-foreground" style={{ letterSpacing: "-0.03em" }}>
            <span>Jarvis</span>
            <span
              className="inline-block h-1 w-1 translate-y-[-2px] rounded-full bg-[var(--copper)]"
              aria-hidden="true"
            />
          </span>
          <LiveClock />
        </div>

        <div className="flex flex-col gap-1.5 text-[12.5px] text-muted-foreground md:items-end">
          <a
            href="mailto:hi@mydearestjarvis.com"
            className="text-foreground transition-opacity hover:opacity-70"
          >
            hi@mydearestjarvis.com
          </a>
          <span className="num uppercase tracking-[0.12em]">© 2026 Jarvis · built solo by David Liu</span>
        </div>
      </div>
    </footer>
  )
}
