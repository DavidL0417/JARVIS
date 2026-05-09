"use client"

import { useEffect, useRef } from "react"

const DOT_SPACING = 28
const DOT_RADIUS = 1.15
const POINTER_RADIUS = 168
const POINTER_STRENGTH = 16
const DRIFT_STRENGTH = 1.85
const POINTER_EASE = 0.055
const RETURN_EASE = 0.04
const WAVE_FREQ_X = 0.0042
const WAVE_FREQ_Y = 0.0036
const WAVE_SPEED_A = 0.32
const WAVE_SPEED_B = 0.21
const FIELD_PADDING = POINTER_RADIUS + DOT_SPACING

type Dot = {
  x: number
  y: number
  phase: number
  speed: number
  weight: number
  ox: number
  oy: number
}

export function CursorSpotlight() {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    if (typeof window === "undefined") return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    const context = canvas.getContext("2d", { alpha: true })
    if (!context) return

    const reducedPointer = window.matchMedia("(pointer: coarse)").matches
    const dots: Dot[] = []
    const pointer = {
      x: -10000,
      y: -10000,
      tx: -10000,
      ty: -10000,
      active: false,
    }

    let raf = 0
    let width = 0
    let height = 0
    let dpr = 1

    const rebuildField = () => {
      dots.length = 0
      width = window.innerWidth
      height = window.innerHeight
      dpr = Math.min(window.devicePixelRatio || 1, 2)

      canvas.width = Math.ceil(width * dpr)
      canvas.height = Math.ceil(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(dpr, 0, 0, dpr, 0, 0)

      const columns = Math.ceil((width + FIELD_PADDING * 2) / DOT_SPACING)
      const rows = Math.ceil((height + FIELD_PADDING * 2) / DOT_SPACING)

      for (let row = 0; row <= rows; row += 1) {
        for (let col = 0; col <= columns; col += 1) {
          const stagger = row % 2 === 0 ? 0 : DOT_SPACING * 0.5
          dots.push({
            x: col * DOT_SPACING - FIELD_PADDING + stagger,
            y: row * DOT_SPACING - FIELD_PADDING,
            phase: (row * 0.73 + col * 0.37) % Math.PI,
            speed: 0.42 + ((row + col) % 7) * 0.034,
            weight: 0.78 + ((row * 3 + col * 5) % 9) * 0.018,
            ox: 0,
            oy: 0,
          })
        }
      }
    }

    const tick = (time: number) => {
      const t = time * 0.001
      pointer.x += (pointer.tx - pointer.x) * 0.09
      pointer.y += (pointer.ty - pointer.y) * 0.09

      context.clearRect(0, 0, width, height)

      for (const dot of dots) {
        const driftX = Math.sin(t * dot.speed + dot.phase) * DRIFT_STRENGTH
        const driftY = Math.cos(t * (dot.speed * 0.74) + dot.phase * 1.4) * (DRIFT_STRENGTH * 0.82)
        const baseX = dot.x + driftX
        const baseY = dot.y + driftY
        let proximity = 0
        let targetOx = 0
        let targetOy = 0

        if (pointer.active) {
          const dx = baseX + dot.ox - pointer.x
          const dy = baseY + dot.oy - pointer.y
          const distance = Math.hypot(dx, dy)

          if (distance < POINTER_RADIUS) {
            proximity = 1 - distance / POINTER_RADIUS
            const force = proximity * proximity * POINTER_STRENGTH
            const angle = Math.atan2(dy, dx)
            targetOx = Math.cos(angle) * force
            targetOy = Math.sin(angle) * force
          }
        }

        const ease = proximity > 0 ? POINTER_EASE : RETURN_EASE
        dot.ox += (targetOx - dot.ox) * ease
        dot.oy += (targetOy - dot.oy) * ease

        const x = baseX + dot.ox
        const y = baseY + dot.oy

        const wave =
          Math.sin(dot.x * WAVE_FREQ_X + dot.y * WAVE_FREQ_Y + t * WAVE_SPEED_A) *
            0.5 +
          Math.sin(dot.x * WAVE_FREQ_Y - dot.y * WAVE_FREQ_X + t * WAVE_SPEED_B + 1.7) *
            0.5
        const waveNorm = (wave + 2) * 0.25
        const pulse = (Math.sin(t * 0.42 + dot.phase * 1.8) + 1) * 0.5
        const baseAlpha = 0.32 + pulse * 0.06 + waveNorm * 0.18
        const alpha = Math.min(0.85, baseAlpha * dot.weight + proximity * 0.32)
        const radius = DOT_RADIUS + proximity * 0.4 + pulse * 0.06 + waveNorm * 0.18

        const warm = waveNorm > 0.55
        context.beginPath()
        context.arc(x, y, radius, 0, Math.PI * 2)
        context.fillStyle =
          proximity > 0
            ? `rgba(245, 178, 104, ${alpha})`
            : warm
              ? `rgba(214, 158, 110, ${alpha})`
              : `rgba(186, 144, 110, ${alpha})`
        context.fill()
      }

      raf = window.requestAnimationFrame(tick)
    }

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return
      pointer.tx = event.clientX
      pointer.ty = event.clientY
      pointer.active = true
      canvas.dataset.active = "true"
    }

    const onLeave = () => {
      pointer.tx = -10000
      pointer.ty = -10000
      pointer.active = false
      canvas.dataset.active = "false"
    }

    rebuildField()
    raf = window.requestAnimationFrame(tick)

    if (!reducedPointer) {
      window.addEventListener("pointermove", onMove)
    }
    window.addEventListener("resize", rebuildField)
    document.addEventListener("pointerleave", onLeave)

    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("resize", rebuildField)
      document.removeEventListener("pointerleave", onLeave)
      window.cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      data-active="false"
      className="cursor-dot-field pointer-events-none fixed inset-0 z-[2]"
    />
  )
}
