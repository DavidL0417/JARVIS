"use client"

import { useEffect, useRef } from "react"

const RADIUS_PX = 136
const READABLE_TEXT_SELECTOR = "a, button, p, h1, h2, h3, h4, li, label, input, textarea, [data-bloom-dim]"

export function CursorSpotlight() {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof window === "undefined") return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    if (window.matchMedia("(pointer: coarse)").matches) return

    let mx = -2000
    let my = -2000
    let cx = mx
    let cy = my
    let raf = 0
    let active = false
    let dimmed = false

    const tick = () => {
      cx += (mx - cx) * 0.18
      cy += (my - cy) * 0.18
      el.style.setProperty("--cx", `${cx.toFixed(1)}px`)
      el.style.setProperty("--cy", `${cy.toFixed(1)}px`)
      raf = window.requestAnimationFrame(tick)
    }

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return
      mx = event.clientX
      my = event.clientY
      if (!active) {
        active = true
        el.style.opacity = "1"
      }
      const target = event.target instanceof Element ? event.target : null
      const shouldDim = Boolean(target?.closest(READABLE_TEXT_SELECTOR))
      if (shouldDim !== dimmed) {
        dimmed = shouldDim
        el.style.opacity = shouldDim ? "0.22" : "1"
      }
    }

    const onLeave = () => {
      mx = -2000
      my = -2000
      active = false
      el.style.opacity = "0"
      dimmed = false
    }

    el.style.opacity = "0"
    el.style.setProperty("--cx", `${mx}px`)
    el.style.setProperty("--cy", `${my}px`)
    raf = window.requestAnimationFrame(tick)

    window.addEventListener("pointermove", onMove)
    document.addEventListener("pointerleave", onLeave)

    return () => {
      window.removeEventListener("pointermove", onMove)
      document.removeEventListener("pointerleave", onLeave)
      window.cancelAnimationFrame(raf)
    }
  }, [])

  const maskImage = `radial-gradient(circle ${RADIUS_PX}px at var(--cx, -2000px) var(--cy, -2000px), rgba(0,0,0,1) 0%, rgba(0,0,0,0.82) 28%, rgba(0,0,0,0.38) 62%, transparent 100%)`

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="cursor-spotlight pointer-events-none fixed inset-0 z-[2]"
      style={{
        backgroundImage:
          "radial-gradient(circle at 1px 1px, oklch(0.84 0.16 52) 1.35px, transparent 0)",
        backgroundSize: "28px 28px",
        backgroundPosition: "0 0",
        backgroundAttachment: "fixed",
        maskImage,
        WebkitMaskImage: maskImage,
        opacity: 0,
        transition: "opacity 320ms ease-out",
        willChange: "opacity",
      }}
    />
  )
}
