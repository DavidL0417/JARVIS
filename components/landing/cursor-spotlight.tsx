"use client"

import { useEffect, useRef } from "react"

const TILE_SIZE = 680
const TILE_SPACING = 28
const POINTER_RADIUS = 150
const CAMERA_EASE = 0.08
const SCROLL_VELOCITY_DAMP = 0.84
const SCROLL_DRAG_STRENGTH = 0.22
const SCROLL_DRAG_MAX = 28
const CURRENT_COUNT = 8
const CURRENT_SEGMENTS = 9
const CURRENT_LENGTH = 620
const CURRENT_WRAP_PADDING = 360

type Current = {
  x: number
  y: number
  phase: number
  speed: number
  depth: number
  width: number
  amplitude: number
  slant: number
  alpha: number
}

type DotTile = {
  canvas: HTMLCanvasElement
  size: number
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const wrap = (value: number, min: number, max: number) => {
  const range = max - min
  return ((((value - min) % range) + range) % range) + min
}

const seededNoise = (value: number) => {
  const n = Math.sin(value * 12.9898) * 43758.5453
  return n - Math.floor(n)
}

function buildDotTile(dpr: number, seed: number, alphaScale: number, radiusScale: number): DotTile {
  const canvas = document.createElement("canvas")
  const size = TILE_SIZE
  const pixelSize = Math.ceil(size * dpr)
  canvas.width = pixelSize
  canvas.height = pixelSize

  const context = canvas.getContext("2d", { alpha: true })
  if (!context) return { canvas, size }

  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, size, size)

  const columns = Math.ceil(size / TILE_SPACING) + 2
  const rows = Math.ceil(size / TILE_SPACING) + 2

  for (let row = -1; row <= rows; row += 1) {
    for (let col = -1; col <= columns; col += 1) {
      const index = seed + row * 41 + col * 97
      const stagger = row % 2 === 0 ? 0 : TILE_SPACING * 0.5
      const jitterX = (seededNoise(index) - 0.5) * 6
      const jitterY = (seededNoise(index + 19) - 0.5) * 6
      const x = col * TILE_SPACING + stagger + jitterX
      const y = row * TILE_SPACING + jitterY
      const pulseBias = seededNoise(index + 31)
      const radius = (0.7 + pulseBias * 0.75) * radiusScale
      const alpha = (0.18 + pulseBias * 0.36) * alphaScale
      const warm = pulseBias > 0.56

      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.fillStyle = warm
        ? `rgba(224, 166, 111, ${alpha})`
        : `rgba(184, 139, 104, ${alpha})`
      context.fill()
    }
  }

  return { canvas, size }
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
    const currents: Current[] = []
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
    let baseTile: DotTile | null = null
    let brightTile: DotTile | null = null
    let lastScrollY = window.scrollY
    let cameraY = lastScrollY
    let scrollVelocity = 0
    let scrollDrag = 0

    const rebuildField = () => {
      currents.length = 0
      width = window.innerWidth
      height = window.innerHeight
      dpr = Math.min(window.devicePixelRatio || 1, 1.25)

      canvas.width = Math.ceil(width * dpr)
      canvas.height = Math.ceil(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.lineCap = "round"
      context.lineJoin = "round"

      baseTile = buildDotTile(dpr, 11, 0.92, 1)
      brightTile = buildDotTile(dpr, 73, 0.48, 0.82)

      for (let i = 0; i < CURRENT_COUNT; i += 1) {
        const fraction = (i + 0.5) / CURRENT_COUNT
        currents.push({
          x: width * fraction + (((i * 29) % 17) - 8) * 11,
          y: -CURRENT_WRAP_PADDING + ((height + CURRENT_WRAP_PADDING * 2) / CURRENT_COUNT) * i,
          phase: i * 1.83,
          speed: 0.44 + (i % 4) * 0.08,
          depth: 0.1 + (i % 5) * 0.03,
          width: 0.7 + (i % 3) * 0.2,
          amplitude: 25 + (i % 4) * 8,
          slant: i % 2 === 0 ? 160 : -130,
          alpha: 0.045 + (i % 4) * 0.016,
        })
      }
    }

    const drawTileLayer = (tile: DotTile | null, offsetX: number, offsetY: number, alpha: number) => {
      if (!tile) return

      const size = tile.size
      const startX = wrap(offsetX, -size, 0)
      const startY = wrap(offsetY, -size, 0)
      context.globalAlpha = alpha

      for (let y = startY; y < height + size; y += size) {
        for (let x = startX; x < width + size; x += size) {
          context.drawImage(tile.canvas, x, y, size, size)
        }
      }

      context.globalAlpha = 1
    }

    const drawCurrent = (current: Current, y: number, t: number, drag: number) => {
      const startY = y - CURRENT_LENGTH * 0.5
      const gradient = context.createLinearGradient(0, startY, 0, startY + CURRENT_LENGTH)
      const alpha = current.alpha + Math.min(0.04, Math.abs(drag) * 0.0014)
      gradient.addColorStop(0, "rgba(232, 168, 110, 0)")
      gradient.addColorStop(0.3, `rgba(214, 158, 110, ${alpha * 0.62})`)
      gradient.addColorStop(0.54, `rgba(245, 178, 104, ${alpha})`)
      gradient.addColorStop(0.82, `rgba(186, 144, 110, ${alpha * 0.5})`)
      gradient.addColorStop(1, "rgba(232, 168, 110, 0)")

      context.beginPath()
      for (let segment = 0; segment <= CURRENT_SEGMENTS; segment += 1) {
        const progress = segment / CURRENT_SEGMENTS
        const py = startY + progress * CURRENT_LENGTH
        const drift =
          Math.sin(t * 1.04 + current.phase + py * 0.008) * current.amplitude +
          Math.sin(t * 0.52 + current.phase * 1.8 + py * 0.014) * (current.amplitude * 0.32)
        const px = current.x + drift + (progress - 0.5) * current.slant + drag * current.depth * 0.22
        if (segment === 0) {
          context.moveTo(px, py)
        } else {
          context.lineTo(px, py)
        }
      }

      context.lineWidth = current.width
      context.strokeStyle = gradient
      context.stroke()
    }

    const drawPointerDots = (offsetX: number, offsetY: number, t: number) => {
      pointer.x += (pointer.tx - pointer.x) * 0.11
      pointer.y += (pointer.ty - pointer.y) * 0.11
      if (!pointer.active) return

      const size = TILE_SIZE
      const startX = wrap(offsetX, -size, 0)
      const startY = wrap(offsetY, -size, 0)
      const pulse = (Math.sin(t * 4.6) + 1) * 0.5
      const minCol = Math.floor((pointer.x - POINTER_RADIUS - startX) / TILE_SPACING) - 1
      const maxCol = Math.ceil((pointer.x + POINTER_RADIUS - startX) / TILE_SPACING) + 1
      const minRow = Math.floor((pointer.y - POINTER_RADIUS - startY) / TILE_SPACING) - 1
      const maxRow = Math.ceil((pointer.y + POINTER_RADIUS - startY) / TILE_SPACING) + 1

      for (let row = minRow; row <= maxRow; row += 1) {
        for (let col = minCol; col <= maxCol; col += 1) {
          const tileRow = ((row % 24) + 24) % 24
          const tileCol = ((col % 24) + 24) % 24
          const index = 11 + tileRow * 41 + tileCol * 97
          const stagger = tileRow % 2 === 0 ? 0 : TILE_SPACING * 0.5
          const x = startX + col * TILE_SPACING + stagger + (seededNoise(index) - 0.5) * 6
          const y = startY + row * TILE_SPACING + (seededNoise(index + 19) - 0.5) * 6
          const dx = x - pointer.x
          const dy = y - pointer.y
          const distance = Math.hypot(dx, dy)
          if (distance > POINTER_RADIUS) continue

          const proximity = 1 - distance / POINTER_RADIUS
          const force = proximity * proximity
          const angle = Math.atan2(dy, dx)
          const pushedX = x + Math.cos(angle) * force * 5
          const pushedY = y + Math.sin(angle) * force * 5
          const radius = 1.3 + force * 1.9 + pulse * 0.18
          const alpha = 0.2 + force * 0.68

          context.beginPath()
          context.arc(pushedX, pushedY, radius, 0, Math.PI * 2)
          context.fillStyle = `rgba(245, 178, 104, ${alpha})`
          context.fill()
        }
      }
    }

    const tick = (time: number) => {
      const t = time * 0.001
      const currentScrollY = window.scrollY
      const rawDelta = currentScrollY - lastScrollY
      lastScrollY = currentScrollY
      cameraY += (currentScrollY - cameraY) * CAMERA_EASE
      scrollVelocity = scrollVelocity * SCROLL_VELOCITY_DAMP + rawDelta * (1 - SCROLL_VELOCITY_DAMP)
      const targetDrag = clamp(scrollVelocity * SCROLL_DRAG_STRENGTH, -SCROLL_DRAG_MAX, SCROLL_DRAG_MAX)
      scrollDrag += (targetDrag - scrollDrag) * 0.15

      context.clearRect(0, 0, width, height)
      context.globalCompositeOperation = "lighter"

      const baseOffsetX = Math.sin(t * 0.18) * 18 - cameraY * 0.025 + scrollDrag * 0.12
      const baseOffsetY = t * 14 - cameraY * 0.18 + scrollDrag * 0.52
      const brightOffsetX = Math.cos(t * 0.23) * 24 + cameraY * 0.018 - scrollDrag * 0.18
      const brightOffsetY = t * -19 - cameraY * 0.27 + scrollDrag * 0.35

      drawTileLayer(
        baseTile,
        baseOffsetX,
        baseOffsetY,
        0.94,
      )
      drawTileLayer(
        brightTile,
        brightOffsetX,
        brightOffsetY,
        0.5 + Math.sin(t * 0.7) * 0.1,
      )

      drawPointerDots(baseOffsetX, baseOffsetY, t)

      const currentSpan = height + CURRENT_WRAP_PADDING * 2
      for (const current of currents) {
        const baseY = wrap(
          current.y + t * current.speed * 96 - cameraY * current.depth,
          -CURRENT_WRAP_PADDING,
          height + CURRENT_WRAP_PADDING,
        )
        drawCurrent(current, baseY, t, scrollDrag)
        if (baseY < CURRENT_LENGTH * 0.6) {
          drawCurrent(current, baseY + currentSpan, t, scrollDrag)
        }
        if (baseY > height - CURRENT_LENGTH * 0.6) {
          drawCurrent(current, baseY - currentSpan, t, scrollDrag)
        }
      }
      context.globalCompositeOperation = "source-over"
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
