"use client"

import { useEffect, useRef, type ReactNode } from "react"

interface AnimatedUnderlineProps {
  children: ReactNode
  delay?: number
  className?: string
}

export function AnimatedUnderline({ children, delay = 700, className = "" }: AnimatedUnderlineProps) {
  const lineRef = useRef<SVGLineElement | null>(null)

  useEffect(() => {
    const line = lineRef.current
    if (!line) return

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    if (reduced) {
      line.style.strokeDashoffset = "0"
      line.style.opacity = "1"
      return
    }

    let cancelled = false
    void (async () => {
      const { animate, eases, svg } = await import("animejs")
      if (cancelled || !line) return

      try {
        const [drawable] = svg.createDrawable(line as unknown as SVGGeometryElement)
        animate(drawable, {
          draw: ["0 0", "0 1"],
          duration: 720,
          delay,
          ease: eases.outQuart,
        })
        line.style.opacity = "1"
      } catch {
        line.style.strokeDashoffset = "0"
        line.style.opacity = "1"
      }
    })()

    return () => {
      cancelled = true
    }
  }, [delay])

  return (
    <span className={`relative inline-block whitespace-nowrap ${className}`}>
      {children}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-[0.05em] left-0 h-[0.12em] w-full"
        preserveAspectRatio="none"
        viewBox="0 0 100 1"
      >
        <line
          ref={lineRef}
          x1="0"
          y1="0.5"
          x2="100"
          y2="0.5"
          stroke="var(--copper)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          style={{ opacity: 0 }}
        />
      </svg>
    </span>
  )
}
