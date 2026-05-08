"use client"

import { useEffect, useRef } from "react"

const HERO_SELECTOR = "#section-hero"
const BASE_OPACITY = "0.52"
const IDLE_OPACITY = "0.16"
const READABLE_OPACITY = "0.08"
const READABLE_TEXT_SELECTOR = "a, button, p, h1, h2, h3, h4, li, label, input, textarea, [data-bloom-dim]"
const BLOOM_SHIELD_SELECTOR = "[data-bloom-shield], [data-bloom-dim]"
const BLOOM_SHIELD_PADDING_PX = 56

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
    let idleTimer = 0

    const tick = () => {
      cx += (mx - cx) * 0.18
      cy += (my - cy) * 0.18
      el.style.setProperty("--cx", `${cx.toFixed(1)}px`)
      el.style.setProperty("--cy", `${cy.toFixed(1)}px`)
      raf = window.requestAnimationFrame(tick)
    }

    const setOpacity = (value: string) => {
      if (el.style.opacity !== value) el.style.opacity = value
    }

    const isInsideBloomShield = (x: number, y: number) => {
      const shields = document.querySelectorAll<HTMLElement>(BLOOM_SHIELD_SELECTOR)
      for (const shield of shields) {
        const rect = shield.getBoundingClientRect()
        if (
          x >= rect.left - BLOOM_SHIELD_PADDING_PX &&
          x <= rect.right + BLOOM_SHIELD_PADDING_PX &&
          y >= rect.top - BLOOM_SHIELD_PADDING_PX &&
          y <= rect.bottom + BLOOM_SHIELD_PADDING_PX
        ) {
          return true
        }
      }
      return false
    }

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return
      mx = event.clientX
      my = event.clientY
      window.clearTimeout(idleTimer)

      const target = document.elementFromPoint(mx, my)
      const inHero = Boolean(target?.closest(HERO_SELECTOR))
      const overReadableText = Boolean(target?.closest(READABLE_TEXT_SELECTOR))

      if (!inHero || isInsideBloomShield(mx, my)) {
        active = false
        setOpacity("0")
        return
      }

      if (!active) {
        active = true
      }

      setOpacity(overReadableText ? READABLE_OPACITY : BASE_OPACITY)
      idleTimer = window.setTimeout(() => setOpacity(IDLE_OPACITY), 850)
    }

    const onLeave = () => {
      window.clearTimeout(idleTimer)
      mx = -2000
      my = -2000
      active = false
      el.style.opacity = "0"
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
      window.clearTimeout(idleTimer)
      window.cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="cursor-spotlight pointer-events-none fixed inset-0 z-[2]"
      style={{
        backgroundImage:
          "radial-gradient(circle 170px at var(--cx, -2000px) var(--cy, -2000px), oklch(0.84 0.15 48 / 0.18), oklch(0.74 0.14 42 / 0.08) 42%, transparent 76%)",
        backgroundSize: "100% 100%",
        backgroundPosition: "0 0",
        backgroundAttachment: "fixed",
        filter: "blur(10px)",
        opacity: 0,
        transition: "opacity 480ms ease-out",
        willChange: "opacity",
      }}
    />
  )
}
