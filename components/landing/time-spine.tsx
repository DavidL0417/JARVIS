"use client"

import { useEffect, useRef, useState } from "react"

interface SectionMap {
  id: string
  index: string
  label: string
  topRatio: number
  heightRatio: number
}

const HOURS = ["06", "09", "12", "15", "18", "21"]

function formatScrollClock(progress: number) {
  const minutes = Math.round(6 * 60 + progress * (21 - 6) * 60)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

export function TimeSpine() {
  const [sections, setSections] = useState<SectionMap[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const fillRef = useRef<HTMLDivElement | null>(null)
  const scrubberRef = useRef<HTMLDivElement | null>(null)
  const clockRef = useRef<HTMLSpanElement | null>(null)
  const labelRefs = useRef<Array<HTMLDivElement | null>>([])
  const blocksAnimatedRef = useRef(false)
  const activeIdRef = useRef<string | null>(null)

  useEffect(() => {
    const measure = () => {
      const max = document.documentElement.scrollHeight
      if (max <= 0) return
      const candidates = document.querySelectorAll<HTMLElement>("[data-spine-section]")
      const measured = Array.from(candidates)
        .map((el, index) => {
          const rect = el.getBoundingClientRect()
          const top = rect.top + window.scrollY
          return {
            id: el.id || el.dataset.spineSection || `section-${index}`,
            index: el.dataset.spineIndex || "",
            label: el.dataset.spineLabel || "",
            top,
          }
        })
        .sort((a, b) => a.top - b.top)

      const found: SectionMap[] = measured.map((section, index) => {
        const blockTop = index === 0 ? 0 : section.top
        const nextTop = measured[index + 1]?.top ?? max
        return {
          id: section.id,
          index: section.index,
          label: section.label,
          topRatio: blockTop / max,
          heightRatio: Math.max(0, nextTop - blockTop) / max,
        }
      })

      setSections(found)
    }

    measure()

    const observer = new ResizeObserver(() => measure())
    document.querySelectorAll<HTMLElement>("[data-spine-section]").forEach((el) => observer.observe(el))
    window.addEventListener("resize", measure)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    const fill = fillRef.current
    const scrubber = scrubberRef.current
    const clock = clockRef.current
    if (!container || !fill || !scrubber || !clock || sections.length === 0) return

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    const computeOverallProgress = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      if (max <= 0) return 0
      return Math.min(1, Math.max(0, window.scrollY / max))
    }

    const findActiveAndProgress = () => {
      const overall = computeOverallProgress()
      let active = sections[0]
      for (const s of sections) {
        if (overall >= s.topRatio) active = s
      }
      const localProgress = Math.min(
        1,
        Math.max(0, (overall - active.topRatio) / Math.max(active.heightRatio, 0.0001)),
      )
      return { active, localProgress }
    }

    const update = () => {
      const overall = computeOverallProgress()
      clock.textContent = formatScrollClock(overall)

      const { active, localProgress } = findActiveAndProgress()

      // fill rises from top of active block, height proportional to local progress
      const blockEl = container.querySelector<HTMLElement>(`[data-section-block="${active.id}"]`)
      if (blockEl) {
        const blockRect = blockEl.getBoundingClientRect()
        const trackRect = container.getBoundingClientRect()
        const blockTopPx = blockRect.top - trackRect.top
        const blockHeightPx = blockRect.height
        const fillHeightPx = Math.max(2, blockHeightPx * localProgress)
        fill.style.transform = `translate3d(0, ${blockTopPx}px, 0)`
        fill.style.height = `${fillHeightPx}px`

        // scrubber sits at the leading edge of the fill (its bottom)
        scrubber.style.transform = `translate3d(0, ${blockTopPx + fillHeightPx - 8}px, 0)`
      }

      if (active.id !== activeIdRef.current) {
        activeIdRef.current = active.id
        setActiveId(active.id)
      }
    }

    update()

    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(() => {
        update()
        ticking = false
      })
    }

    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll, { passive: true })

    if (reduced) {
      const labels = labelRefs.current.filter(Boolean) as HTMLDivElement[]
      labels.forEach((el) => {
        el.style.opacity = "1"
        el.style.transform = "translate3d(0,0,0)"
      })
      scrubber.style.opacity = "1"
      fill.style.opacity = "1"
      const blocks = container.querySelectorAll<HTMLElement>("[data-section-block]")
      blocks.forEach((el) => {
        el.style.opacity = "1"
      })
      return () => {
        window.removeEventListener("scroll", onScroll)
        window.removeEventListener("resize", onScroll)
      }
    }

    let cancelled = false
    void (async () => {
      const { animate, stagger, eases } = await import("animejs")
      if (cancelled) return

      if (!blocksAnimatedRef.current) {
        const labels = labelRefs.current.filter(Boolean) as HTMLDivElement[]
        animate(labels, {
          opacity: [0, 1],
          translateY: [-6, 0],
          duration: 540,
          delay: stagger(70, { start: 80 }),
          ease: eases.outQuart,
        })
        const blocks = container.querySelectorAll<HTMLElement>("[data-section-block]")
        animate(Array.from(blocks), {
          opacity: [0, 1],
          translateX: [-8, 0],
          duration: 600,
          delay: stagger(60, { start: 200 }),
          ease: eases.outQuart,
        })
        animate(fill, {
          opacity: [0, 1],
          duration: 480,
          delay: 720,
          ease: eases.outQuart,
        })
        animate(scrubber, {
          opacity: [0, 1],
          scale: [0.6, 1],
          duration: 500,
          delay: 740,
          ease: eases.outQuart,
        })
        blocksAnimatedRef.current = true
      }
    })()

    return () => {
      cancelled = true
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
  }, [sections])

  const handleSectionClick = (id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <aside
      aria-hidden="true"
      className="time-spine pointer-events-none fixed left-0 top-14 z-20 hidden h-[calc(100vh-56px)] w-16 md:flex"
    >
      <div className="relative ml-auto h-full w-full">
        {/* vertical rule */}
        <span className="absolute left-[34px] top-3 bottom-3 w-px bg-[var(--rule)]" aria-hidden="true" />

        <div ref={containerRef} className="absolute inset-y-3 left-0 right-0">
          {/* hour ticks crossing the rule */}
          {HOURS.map((label, index) => {
            const top = (index / (HOURS.length - 1)) * 100
            return (
              <div
                key={label}
                ref={(el) => {
                  labelRefs.current[index] = el
                }}
                className="absolute left-0 right-0 flex items-center opacity-0"
                style={{ top: `${top}%`, transform: "translateY(-50%)" }}
              >
                <span
                  aria-hidden="true"
                  className="absolute h-px bg-[var(--rule-strong)]"
                  style={{ left: 28, width: 14 }}
                />
                <span
                  className="landing-mark absolute text-[9.5px] font-medium leading-none text-muted-foreground"
                  style={{ left: 46 }}
                >
                  {label}
                </span>
              </div>
            )
          })}

          {/* section blocks (track lanes) */}
          {sections.map((section) => {
            const isActive = section.id === activeId
            const isHovered = section.id === hoveredId
            const top = section.topRatio * 100
            const height = Math.max(section.heightRatio * 100, 4)
            const targetWidth = isHovered ? 16 : 6
            return (
              <button
                type="button"
                key={section.id}
                data-section-block={section.id}
                onMouseEnter={() => setHoveredId(section.id)}
                onMouseLeave={() => setHoveredId((id) => (id === section.id ? null : id))}
                onClick={() => handleSectionClick(section.id)}
                aria-label={`Jump to section ${section.index} ${section.label}`}
                tabIndex={0}
                className="pointer-events-auto absolute cursor-pointer rounded-[2px] opacity-0 outline-none focus-visible:ring-1 focus-visible:ring-[var(--copper)] focus-visible:ring-offset-1"
                style={{
                  left: `${34 - targetWidth + 1}px`,
                  top: `${top}%`,
                  height: `${height}%`,
                  width: `${targetWidth}px`,
                  background: isActive
                    ? "oklch(0.32 0.014 35)"
                    : isHovered
                    ? "oklch(0.40 0.018 35)"
                    : "var(--rule)",
                  transition: "width 380ms cubic-bezier(0.22, 1, 0.36, 1), background-color 320ms ease-out, left 380ms cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              >
                {isHovered && section.label ? (
                  <span
                    className="pointer-events-none absolute inset-y-0 left-0 right-0 flex items-center justify-center"
                    style={{
                      writingMode: "vertical-rl",
                      transform: "rotate(180deg)",
                    }}
                  >
                    <span className="landing-mark text-[8.5px] font-semibold leading-none text-foreground/90 whitespace-nowrap">
                      {section.index} / {section.label}
                    </span>
                  </span>
                ) : null}
              </button>
            )
          })}

          {/* the live copper fill that rises within the active block */}
          <div
            ref={fillRef}
            data-fill
            aria-hidden="true"
            className="pointer-events-none absolute left-[7px] w-[28px] origin-top opacity-0"
            style={{
              top: 0,
              height: "0px",
              background:
                "linear-gradient(to bottom, oklch(0.74 0.14 42 / 0.92), oklch(0.78 0.14 45))",
              borderRadius: "2px 2px 0 0",
              boxShadow: "0 0 0 1px oklch(0.84 0.12 50 / 0.6) inset, 0 8px 24px -8px oklch(0.74 0.14 42 / 0.7)",
              transition: "opacity 180ms ease-out",
              willChange: "transform, height",
            }}
          />

          {/* scrubber pill — anchored to the bottom edge of the fill */}
          <div
            ref={scrubberRef}
            className="pointer-events-none absolute left-0 flex items-center gap-1 opacity-0"
            style={{ top: 0, transform: "translate3d(0, 0, 0)", willChange: "transform" }}
          >
            <span className="landing-mark inline-flex items-center rounded-[2px] bg-[var(--copper)] px-1 py-[2px] text-[9px] font-semibold leading-none text-[var(--background)] whitespace-nowrap shadow-[0_4px_12px_-4px_oklch(0.74_0.14_42_/_0.6)]">
              <span ref={clockRef}>06:00</span>
            </span>
            <span className="block h-[1.5px] w-2 bg-[var(--copper)]" aria-hidden="true" />
          </div>
        </div>
      </div>
    </aside>
  )
}
