"use client"

import { useEffect, useRef, useState } from "react"

/**
 * The "what it isn't" block. The lines sit dim, then each one lights up in turn
 * as it scrolls up past a trigger band — so the highlight tracks the scroll
 * rather than every line being lit at once. The final line lights up in the same
 * copper accent as the closing "remembers". Per-line IntersectionObserver only
 * (no scroll handler) and it animates color/transform exclusively, so it stays
 * at 60fps. Activation is sticky: once a line is lit it stays lit.
 */
export function Refrain({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLUListElement | null>(null)
  const [active, setActive] = useState<boolean[]>(() => lines.map(() => false))

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const items = Array.from(node.querySelectorAll<HTMLLIElement>(".refrain-line"))

    const activateAll = () => setActive(lines.map(() => true))

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduced || !("IntersectionObserver" in window)) {
      activateAll()
      return
    }

    const light = (idx: number) =>
      setActive((prev) => {
        if (idx < 0 || prev[idx]) return prev
        const next = [...prev]
        next[idx] = true
        return next
      })

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) light(items.indexOf(entry.target as HTMLLIElement))
        }
      },
      // A line lights up once it has scrolled up past ~62% of the viewport.
      { root: null, rootMargin: "0px 0px -38% 0px", threshold: 0 },
    )
    items.forEach((item) => observer.observe(item))

    // Already-on-screen safety (refresh mid-page, bfcache): light anything already
    // above the trigger so it doesn't sit dim until the next scroll.
    const lightWhatsAbove = () => {
      if (document.visibilityState !== "visible") return
      const trigger = window.innerHeight * 0.62
      items.forEach((item, idx) => {
        if (item.getBoundingClientRect().top < trigger) light(idx)
      })
    }
    window.requestAnimationFrame(lightWhatsAbove)
    window.addEventListener("pageshow", lightWhatsAbove)
    document.addEventListener("visibilitychange", lightWhatsAbove)

    return () => {
      observer.disconnect()
      window.removeEventListener("pageshow", lightWhatsAbove)
      document.removeEventListener("visibilitychange", lightWhatsAbove)
    }
  }, [lines])

  return (
    <ul
      ref={ref}
      className="refrain landing-display mt-6 max-w-[42ch] space-y-2 text-[clamp(1.5rem,3vw,2.4rem)] font-semibold leading-[1.12]"
    >
      {lines.map((line, index) => {
        const isFinal = index === lines.length - 1
        return (
          <li
            key={line}
            data-active={active[index] ? "true" : "false"}
            className={isFinal ? "refrain-line refrain-line-final" : "refrain-line"}
          >
            {line}
          </li>
        )
      })}
    </ul>
  )
}
