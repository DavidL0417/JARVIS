"use client"

import { useEffect, useRef } from "react"

const RADIUS = 320

export function CursorAmbient() {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof window === "undefined") return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    if (window.matchMedia("(pointer: coarse)").matches) return

    let mx = window.innerWidth / 2
    let my = -RADIUS
    let cx = mx
    let cy = my
    let raf = 0
    let active = false

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return
      mx = event.clientX
      my = event.clientY
      if (!active) {
        active = true
        el.style.opacity = "1"
      }
    }

    const onLeave = () => {
      mx = window.innerWidth / 2
      my = -RADIUS
      active = false
      el.style.opacity = "0"
    }

    const tick = () => {
      cx += (mx - cx) * 0.14
      cy += (my - cy) * 0.14
      el.style.transform = `translate3d(${cx - RADIUS}px, ${cy - RADIUS}px, 0)`
      raf = window.requestAnimationFrame(tick)
    }

    el.style.opacity = "0"
    el.style.transform = `translate3d(${mx - RADIUS}px, ${my - RADIUS}px, 0)`
    raf = window.requestAnimationFrame(tick)

    window.addEventListener("pointermove", onMove)
    document.addEventListener("pointerleave", onLeave)

    return () => {
      window.removeEventListener("pointermove", onMove)
      document.removeEventListener("pointerleave", onLeave)
      window.cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="cursor-ambient pointer-events-none fixed left-0 top-0 z-[40]"
      style={{
        width: RADIUS * 2,
        height: RADIUS * 2,
        borderRadius: "50%",
        background:
          "radial-gradient(circle, oklch(0.74 0.14 42 / 0.14), oklch(0.74 0.14 42 / 0.05) 38%, transparent 65%)",
        mixBlendMode: "screen",
        opacity: 0,
        transition: "opacity 280ms ease-out",
        willChange: "transform, opacity",
      }}
    />
  )
}
