"use client"

import { useEffect, useMemo, useRef, type CSSProperties } from "react"

import type { LandingMotionState } from "@/components/landing/landing-motion"

interface SectionScenesProps {
  motion: LandingMotionState
}

const sourceChannels = [
  {
    id: "source-a",
    d: "M -80 170 C 140 110 260 118 400 225 S 610 390 760 356",
    color: "var(--signal-copper)",
  },
  {
    id: "source-b",
    d: "M 1260 150 C 1060 118 940 170 805 282 S 610 390 500 332",
    color: "var(--signal-teal)",
  },
  {
    id: "source-c",
    d: "M 80 760 C 250 600 360 570 505 565 S 670 424 760 356",
    color: "var(--signal-blue)",
  },
  {
    id: "source-d",
    d: "M 1180 720 C 1040 608 970 580 850 544 S 680 430 500 332",
    color: "var(--signal-green)",
  },
] as const

const packetPositions = [
  { cx: 86, cy: 176, delay: "0ms", tone: "var(--signal-copper)" },
  { cx: 1056, cy: 152, delay: "360ms", tone: "var(--signal-teal)" },
  { cx: 180, cy: 640, delay: "720ms", tone: "var(--signal-blue)" },
  { cx: 960, cy: 618, delay: "1080ms", tone: "var(--signal-green)" },
  { cx: 418, cy: 256, delay: "1440ms", tone: "var(--signal-copper)" },
  { cx: 808, cy: 458, delay: "1800ms", tone: "var(--signal-teal)" },
] as const

const planBlocks = [
  { y: 144, h: 54, tone: "var(--signal-teal)", delay: 0 },
  { y: 218, h: 92, tone: "var(--signal-copper)", delay: 0.13 },
  { y: 338, h: 44, tone: "var(--signal-blue)", delay: 0.25 },
  { y: 422, h: 74, tone: "var(--signal-green)", delay: 0.37 },
  { y: 526, h: 58, tone: "var(--signal-copper)", delay: 0.49 },
] as const

const NOISE_TONES = [
  "var(--signal-copper)",
  "var(--signal-teal)",
  "var(--signal-blue)",
  "var(--signal-green)",
] as const

function noise(seed: number) {
  const v = Math.sin(seed * 12.9898) * 43758.5453
  return v - Math.floor(v)
}

const round = (value: number, digits = 3) => Number(value.toFixed(digits))

const noiseLines = Array.from({ length: 22 }).map((_, i) => {
  const cx = 620
  const cy = 374
  const a = noise(i * 1.31 + 4.7)
  const b = noise(i * 0.91 + 17.3)
  const c = noise(i * 2.13 + 31.7)
  const d = noise(i * 0.57 + 53.1)

  // Spread across the viewport, biased away from the centre so they have somewhere
  // to consolidate from.
  const radius = 220 + c * 360
  const angle = a * Math.PI * 2
  const x = cx + Math.cos(angle) * radius
  const y = cy + Math.sin(angle) * radius * 0.7

  // Each segment has its own random orientation and length.
  const segAngle = b * Math.PI * 2
  const segLen = 14 + d * 26
  const dx = Math.cos(segAngle) * segLen * 0.5
  const dy = Math.sin(segAngle) * segLen * 0.5

  // Round all numeric values up-front so server and client serialize identically.
  return {
    id: `noise-${i}`,
    x1: round(x - dx),
    y1: round(y - dy),
    x2: round(x + dx),
    y2: round(y + dy),
    tx: round((cx - x) * 0.92),
    ty: round((cy - y) * 0.92),
    rotate: round((b - 0.5) * 26),
    tone: NOISE_TONES[i % NOISE_TONES.length],
    bias: round(0.55 + c * 0.45),
  }
})

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

export function SectionScenes({ motion }: SectionScenesProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const stage = useMemo(() => {
    const sp = motion.sceneProgress
    const systemOpacity = clamp01((sp - 0.16) * 1.58)
    // Entropy noise lines have their own independent ramp so they peak in the
    // hero-exit / early-problem window, before the curated curves appear.
    const noiseDraw = clamp01((sp - 0.32) * 0.78)
    // Streams now wait until the entropy has had its moment, then emerge.
    const streamDraw = clamp01((sp - 1.5) * 0.55)
    const gather = clamp01((sp - 1.85) * 0.42)
    const planDraw = clamp01((sp - 2.55) * 0.5)
    const finish = clamp01((motion.overallProgress - 0.78) / 0.22)
    const finalAct = clamp01(Math.max((sp - 4.15) * 0.95, finish))
    const planLock = clamp01((sp - 3.4) * 0.55 + finalAct * 0.12)
    const scatter = clamp01(0.22 + (1 - Math.abs(sp - 1.45)) * 0.34 - planLock * 0.08)
    const filterOut = clamp01((sp - 3.7) * 0.72 + finalAct * 0.1)
    const finalDim = clamp01(Math.max((sp - 4.35) * 1.55, (finish - 0.4) * 2.0))

    return {
      gather,
      "--scene-p": sp.toFixed(4),
      "--scene-progress": sp.toFixed(4),
      "--system-opacity": systemOpacity.toFixed(4),
      "--overall-p": motion.overallProgress.toFixed(4),
      "--noise-draw": noiseDraw.toFixed(4),
      "--stream-draw": streamDraw.toFixed(4),
      "--gather-p": gather.toFixed(4),
      "--plan-draw": planDraw.toFixed(4),
      "--plan-lock": planLock.toFixed(4),
      "--scatter-p": scatter.toFixed(4),
      "--filter-p": filterOut.toFixed(4),
      "--final-p": finalAct.toFixed(4),
      "--final-dim": finalDim.toFixed(4),
    } as CSSProperties & { gather: number }
  }, [motion.sceneProgress, motion.overallProgress, motion.reducedMotion])

  const { gather, ...stageStyle } = stage

  useEffect(() => {
    const root = rootRef.current
    if (!root || motion.reducedMotion) return

    let cancelled = false
    void (async () => {
      const { animate, stagger, eases } = await import("animejs")
      if (cancelled) return

      animate(root.querySelectorAll(".source-channel"), {
        opacity: [0, 1],
        translateY: [16, 0],
        duration: 820,
        delay: stagger(95, { start: 120 }),
        ease: eases.outExpo,
      })
      animate(root.querySelectorAll(".source-node, .plan-node"), {
        opacity: [0, 1],
        scale: [0.72, 1],
        duration: 680,
        delay: stagger(55, { start: 260 }),
        ease: eases.outQuart,
      })
    })()

    return () => {
      cancelled = true
    }
  }, [motion.reducedMotion])

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className="section-scenes pointer-events-none fixed inset-0 z-[1] overflow-hidden"
      data-active-scene={motion.activeId}
      data-reduced-motion={motion.reducedMotion ? "true" : "false"}
      style={stageStyle}
    >
      <div className="source-plan-aura" />
      <svg className="source-plan-svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="schedule-rail-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="oklch(0.74 0.14 42)" stopOpacity="0" />
            <stop offset="0.18" stopColor="oklch(0.74 0.14 42)" stopOpacity="0.72" />
            <stop offset="0.72" stopColor="oklch(0.70 0.09 185)" stopOpacity="0.62" />
            <stop offset="1" stopColor="oklch(0.74 0.14 42)" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="source-core-gradient">
            <stop offset="0" stopColor="oklch(0.90 0.09 56)" stopOpacity="0.92" />
            <stop offset="0.36" stopColor="oklch(0.74 0.14 42)" stopOpacity="0.34" />
            <stop offset="1" stopColor="oklch(0.74 0.14 42)" stopOpacity="0" />
          </radialGradient>
          <filter id="signal-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g className="source-plan-grid">
          {Array.from({ length: 9 }).map((_, index) => (
            <line key={`h-${index}`} x1="80" x2="1120" y1={116 + index * 72} y2={116 + index * 72} />
          ))}
          {Array.from({ length: 8 }).map((_, index) => (
            <line key={`v-${index}`} y1="72" y2="728" x1={154 + index * 132} x2={154 + index * 132} />
          ))}
        </g>

        <g className="source-noise">
          {noiseLines.map((line) => (
            <line
              key={line.id}
              className="source-noise-line"
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke={line.tone}
              style={
                {
                  ["--noise-tx"]: `${line.tx}px`,
                  ["--noise-ty"]: `${line.ty}px`,
                  ["--noise-rot"]: `${line.rotate}deg`,
                  ["--noise-bias"]: String(line.bias),
                  transformOrigin: `${round((line.x1 + line.x2) / 2)}px ${round((line.y1 + line.y2) / 2)}px`,
                } as CSSProperties
              }
            />
          ))}
        </g>

        <g className="source-streams" filter="url(#signal-glow)">
          {sourceChannels.map((channel, index) => (
            <path
              key={channel.id}
              className={`source-channel ${channel.id}`}
              d={channel.d}
              pathLength={1}
              fill="none"
              stroke={channel.color}
              strokeWidth={index === 0 ? 1.5 : 1.2}
              style={{ ["--channel-index" as string]: index }}
            />
          ))}
        </g>

        <g className="source-nodes">
          <circle className="source-node node-a" cx="150" cy="168" r="4.5" />
          <circle className="source-node node-b" cx="1030" cy="156" r="4.5" />
          <circle className="source-node node-c" cx="170" cy="690" r="4.5" />
          <circle className="source-node node-d" cx="1015" cy="654" r="4.5" />
          <circle className="source-node node-e" cx="402" cy="224" r="3" />
          <circle className="source-node node-f" cx="804" cy="282" r="3" />
          <circle className="source-node node-g" cx="506" cy="566" r="3" />
          <circle className="source-node node-h" cx="850" cy="544" r="3" />
        </g>

        <g className="signal-packets">
          {packetPositions.map((packet, index) => (
            <circle
              key={index}
              className="signal-packet"
              cx={packet.cx}
              cy={packet.cy}
              r="3.5"
              fill={packet.tone}
              style={{
                animationDelay: packet.delay,
                color: packet.tone,
                transform: `translate(${(620 - packet.cx) * gather * 0.42}px, ${(374 - packet.cy) * gather * 0.42}px)`,
              }}
            />
          ))}
        </g>

        <g className="convergence-core" transform="translate(620 374)">
          <circle r="132" fill="url(#source-core-gradient)" />
          <circle className="core-ring core-ring-a" r="96" pathLength={1} />
          <circle className="core-ring core-ring-b" r="54" pathLength={1} />
          <path className="core-crosshair" d="M -118 0 H -58 M 58 0 H 118 M 0 -118 V -58 M 0 58 V 118" />
          <circle className="plan-node" r="5" />
        </g>

        <g className="plan-geometry">
          <line className="plan-rail" x1="860" x2="860" y1="112" y2="638" pathLength={1} />
          {Array.from({ length: 7 }).map((_, index) => (
            <line
              key={index}
              className="plan-tick"
              x1="818"
              x2="1018"
              y1={130 + index * 78}
              y2={130 + index * 78}
              pathLength={1}
              style={{ ["--tick-index" as string]: index }}
            />
          ))}
          {planBlocks.map((block, index) => (
            <rect
              key={index}
              className="plan-block"
              x="884"
              y={block.y}
              width="188"
              height={block.h}
              rx="3"
              stroke={block.tone}
              fill={block.tone}
              style={{ ["--block-delay" as string]: block.delay }}
            />
          ))}
        </g>

        <g className="filter-marks">
          <path className="filter-slash filter-slash-a" d="M 156 626 L 284 498" pathLength={1} />
          <path className="filter-slash filter-slash-b" d="M 926 228 L 1080 74" pathLength={1} />
        </g>

        <g className="final-resolve">
          <path className="final-horizon" d="M 140 660 H 1060" pathLength={1} />
          <circle className="final-pulse" cx="860" cy="660" r="5.5" />
        </g>
      </svg>
      <div className="source-plan-final-dim" />
      <div className="source-plan-readability" />
    </div>
  )
}
