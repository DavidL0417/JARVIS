"use client"

import { useEffect, type RefObject } from "react"

interface MagneticPullOptions {
  strength?: number
  radius?: number
}

export function useMagneticPull<T extends HTMLElement>(
  ref: RefObject<T | null>,
  { strength = 0.22, radius = 90 }: MagneticPullOptions = {},
) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof window === "undefined") return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    if (window.matchMedia("(pointer: coarse)").matches) return

    let raf = 0
    let targetX = 0
    let targetY = 0
    let currentX = 0
    let currentY = 0

    const tick = () => {
      currentX += (targetX - currentX) * 0.18
      currentY += (targetY - currentY) * 0.18
      el.style.transform = `translate3d(${currentX.toFixed(2)}px, ${currentY.toFixed(2)}px, 0)`
      if (
        Math.abs(targetX - currentX) > 0.05 ||
        Math.abs(targetY - currentY) > 0.05
      ) {
        raf = window.requestAnimationFrame(tick)
      } else {
        raf = 0
      }
    }

    const ensureTicking = () => {
      if (!raf) raf = window.requestAnimationFrame(tick)
    }

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return
      const rect = el.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const dx = event.clientX - cx
      const dy = event.clientY - cy
      const distance = Math.hypot(dx, dy)
      if (distance > radius) {
        targetX = 0
        targetY = 0
      } else {
        const factor = (1 - distance / radius) * strength
        targetX = dx * factor
        targetY = dy * factor
      }
      ensureTicking()
    }

    const onLeave = () => {
      targetX = 0
      targetY = 0
      ensureTicking()
    }

    document.addEventListener("pointermove", onMove)
    document.addEventListener("pointerleave", onLeave)
    return () => {
      document.removeEventListener("pointermove", onMove)
      document.removeEventListener("pointerleave", onLeave)
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [ref, strength, radius])
}
