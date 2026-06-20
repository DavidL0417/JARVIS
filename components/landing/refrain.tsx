"use client"

import { useEffect, useRef, useState } from "react"

/**
 * The "what it isn't" block. Each line fades + lifts into place on its own,
 * staggered, the first time the list scrolls into view. IntersectionObserver
 * only (no scroll handler), and it animates opacity/transform exclusively —
 * so it stays at 60fps and never re-runs.
 */
export function Refrain({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLUListElement | null>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const reveal = () => setShown(true)

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduced || !("IntersectionObserver" in window)) {
      reveal()
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        reveal()
        observer.disconnect()
      },
      { root: null, rootMargin: "0px 0px -18% 0px", threshold: 0.15 },
    )

    observer.observe(node)
    // bfcache / tab-restore safety: if it's already on screen, show it.
    const revealIfVisible = () => {
      if (document.visibilityState !== "visible") return
      const rect = node.getBoundingClientRect()
      if (rect.top < window.innerHeight * 0.92 && rect.bottom > 0) reveal()
    }
    window.addEventListener("pageshow", revealIfVisible)
    document.addEventListener("visibilitychange", revealIfVisible)

    return () => {
      observer.disconnect()
      window.removeEventListener("pageshow", revealIfVisible)
      document.removeEventListener("visibilitychange", revealIfVisible)
    }
  }, [])

  return (
    <ul
      ref={ref}
      data-shown={shown}
      className="refrain landing-display mt-6 max-w-[42ch] space-y-2 text-[clamp(1.5rem,3vw,2.4rem)] font-semibold leading-[1.12]"
    >
      {lines.map((line, index) => {
        const isFinal = index === lines.length - 1
        return (
          <li
            key={line}
            className={isFinal ? "refrain-line refrain-line-final" : "refrain-line"}
            style={{ transitionDelay: `${index * 150}ms` }}
          >
            {line}
          </li>
        )
      })}
    </ul>
  )
}
