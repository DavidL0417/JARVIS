"use client"

import { useEffect, useRef } from "react"

const DOT_SPACING = 28
const DOT_RADIUS = 1.05
const POINTER_RADIUS = 148
const POINTER_STRENGTH = 23
const DRIFT_STRENGTH = 1.9
const FIELD_PADDING = POINTER_RADIUS + DOT_SPACING

type Dot = {
  x: number
  y: number
  phase: number
  speed: number
  weight: number
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
            speed: 0.55 + ((row + col) % 7) * 0.045,
            weight: 0.72 + ((row * 3 + col * 5) % 9) * 0.035,
          })
        }
      }
    }

    const draw = (time: number) => {
      const t = time * 0.001
      pointer.x += (pointer.tx - pointer.x) * 0.16
      pointer.y += (pointer.ty - pointer.y) * 0.16

      context.clearRect(0, 0, width, height)

      for (const dot of dots) {
        const driftX = Math.sin(t * dot.speed + dot.phase) * DRIFT_STRENGTH
        const driftY = Math.cos(t * (dot.speed * 0.82) + dot.phase * 1.7) * DRIFT_STRENGTH
        let x = dot.x + driftX
        let y = dot.y + driftY
        let proximity = 0

        if (pointer.active) {
          const dx = x - pointer.x
          const dy = y - pointer.y
          const distance = Math.hypot(dx, dy)

          if (distance < POINTER_RADIUS) {
            proximity = 1 - distance / POINTER_RADIUS
            const force = proximity * proximity * POINTER_STRENGTH
            const angle = Math.atan2(dy, dx)
            x += Math.cos(angle) * force
            y += Math.sin(angle) * force
          }
        }

        const pulse = (Math.sin(t * 1.35 + dot.phase * 2.1) + 1) * 0.5
        const baseAlpha = 0.18 + pulse * 0.055
        const alpha = Math.min(0.9, baseAlpha * dot.weight + proximity * 0.58)
        const radius = DOT_RADIUS + proximity * 1.25 + pulse * 0.12

        context.beginPath()
        context.arc(x, y, radius, 0, Math.PI * 2)
        context.fillStyle =
          proximity > 0
            ? `rgba(242, 169, 92, ${alpha})`
            : `rgba(168, 128, 96, ${alpha})`
        context.fill()
      }

      raf = window.requestAnimationFrame(tick)
    }

    const tick = (time: number) => {
      draw(time)
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
