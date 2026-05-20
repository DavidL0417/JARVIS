"use client"

import { useMemo, type CSSProperties } from "react"

import type { LandingMotionState } from "@/components/landing/landing-motion"

interface SectionScenesProps {
  motion: LandingMotionState
}

const CENTER_X = 620
const CENTER_Y = 374

type Track = {
  id: string
  tone: string
  width: number
}

type Point = {
  x: number
  y: number
}

type TravelerTrack = Track & {
  lane: 1 | 2 | 3
  start: Point
  c1: Point
  c2: Point
  end: Point
  delay: number
}

const SOURCE_TRAVELERS: TravelerTrack[] = [
  {
    id: "source-gmail-1",
    lane: 1,
    tone: "var(--signal-copper)",
    width: 1.65,
    start: { x: -80, y: 120 },
    c1: { x: 258, y: 74 },
    c2: { x: 720, y: 250 },
    end: { x: 1034, y: 304 },
    delay: 0,
  },
  {
    id: "source-canvas-1",
    lane: 1,
    tone: "var(--signal-teal)",
    width: 1.35,
    start: { x: 1280, y: 100 },
    c1: { x: 1008, y: 122 },
    c2: { x: 868, y: 250 },
    end: { x: 760, y: 286 },
    delay: 0.08,
  },
  {
    id: "source-notion-1",
    lane: 1,
    tone: "var(--signal-green)",
    width: 1.2,
    start: { x: -128, y: 232 },
    c1: { x: 120, y: 210 },
    c2: { x: 290, y: 304 },
    end: { x: 188, y: 292 },
    delay: 0.16,
  },
  {
    id: "source-calendar-1",
    lane: 1,
    tone: "var(--signal-blue)",
    width: 1.28,
    start: { x: 1300, y: 250 },
    c1: { x: 1076, y: 194 },
    c2: { x: 794, y: 318 },
    end: { x: 620, y: 286 },
    delay: 0.24,
  },
  {
    id: "source-gmail-2",
    lane: 2,
    tone: "var(--signal-copper)",
    width: 1.55,
    start: { x: 1292, y: 346 },
    c1: { x: 1048, y: 302 },
    c2: { x: 882, y: 432 },
    end: { x: 1042, y: 414 },
    delay: 0.03,
  },
  {
    id: "source-calendar-2",
    lane: 2,
    tone: "var(--signal-blue)",
    width: 1.3,
    start: { x: -92, y: 382 },
    c1: { x: 268, y: 320 },
    c2: { x: 470, y: 438 },
    end: { x: 638, y: 388 },
    delay: 0.11,
  },
  {
    id: "source-canvas-2",
    lane: 2,
    tone: "var(--signal-teal)",
    width: 1.25,
    start: { x: -124, y: 520 },
    c1: { x: 190, y: 454 },
    c2: { x: 390, y: 436 },
    end: { x: 178, y: 398 },
    delay: 0.2,
  },
  {
    id: "source-notion-2",
    lane: 2,
    tone: "var(--signal-green)",
    width: 1.18,
    start: { x: 1322, y: 540 },
    c1: { x: 1128, y: 454 },
    c2: { x: 884, y: 392 },
    end: { x: 884, y: 352 },
    delay: 0.28,
  },
  {
    id: "source-notion-3",
    lane: 3,
    tone: "var(--signal-green)",
    width: 1.25,
    start: { x: 1290, y: 612 },
    c1: { x: 990, y: 560 },
    c2: { x: 800, y: 552 },
    end: { x: 1056, y: 498 },
    delay: 0.06,
  },
  {
    id: "source-gmail-3",
    lane: 3,
    tone: "var(--signal-copper)",
    width: 1.6,
    start: { x: -100, y: 656 },
    c1: { x: 260, y: 592 },
    c2: { x: 488, y: 694 },
    end: { x: 664, y: 500 },
    delay: 0.14,
  },
  {
    id: "source-calendar-3",
    lane: 3,
    tone: "var(--signal-blue)",
    width: 1.35,
    start: { x: -140, y: 724 },
    c1: { x: 170, y: 734 },
    c2: { x: 314, y: 538 },
    end: { x: 166, y: 506 },
    delay: 0.22,
  },
  {
    id: "source-canvas-3",
    lane: 3,
    tone: "var(--signal-teal)",
    width: 1.15,
    start: { x: 1310, y: 720 },
    c1: { x: 1080, y: 748 },
    c2: { x: 852, y: 578 },
    end: { x: 902, y: 552 },
    delay: 0.3,
  },
]

const STEP_TRACKS: TravelerTrack[] = [
  {
    id: "step-line-1",
    lane: 1,
    tone: "var(--signal-copper)",
    width: 1.22,
    start: { x: 188, y: 292 },
    c1: { x: 336, y: 252 },
    c2: { x: 478, y: 318 },
    end: { x: 1034, y: 304 },
    delay: 0,
  },
  {
    id: "step-line-2",
    lane: 2,
    tone: "var(--signal-teal)",
    width: 1.08,
    start: { x: 178, y: 398 },
    c1: { x: 342, y: 350 },
    c2: { x: 500, y: 430 },
    end: { x: 1042, y: 414 },
    delay: 0.12,
  },
  {
    id: "step-line-3",
    lane: 3,
    tone: "var(--signal-blue)",
    width: 1.14,
    start: { x: 166, y: 506 },
    c1: { x: 328, y: 550 },
    c2: { x: 512, y: 468 },
    end: { x: 1056, y: 498 },
    delay: 0.24,
  },
]

const CENTER_TRACKS: TravelerTrack[] = SOURCE_TRAVELERS.map((track, index) => {
  const side = track.end.x < CENTER_X ? -1 : 1
  const lanePull = track.lane === 1 ? -34 : track.lane === 3 ? 34 : 0

  return {
    id: `center-${track.id}`,
    lane: track.lane,
    tone: track.tone,
    width: track.width * 0.88,
    start: track.end,
    c1: {
      x: track.end.x - side * (92 + (index % 3) * 22),
      y: track.end.y + lanePull,
    },
    c2: {
      x: CENTER_X + side * (84 + (index % 4) * 16),
      y: CENTER_Y + lanePull * 0.45,
    },
    end: { x: CENTER_X, y: CENTER_Y },
    delay: (index % 6) * 0.035,
  }
})

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function smoothstep(value: number) {
  return value * value * (3 - 2 * value)
}

function pathFor(track: TravelerTrack) {
  return `M ${track.start.x} ${track.start.y} C ${track.c1.x} ${track.c1.y}, ${track.c2.x} ${track.c2.y}, ${track.end.x} ${track.end.y}`
}

function dashWindow(progress: number, length: number) {
  const end = clamp01(progress)
  const start = clamp01(end - length)
  const visible = Math.max(0, end - start)

  return {
    dasharray: `${Math.max(visible, 0.0001).toFixed(4)} 1`,
    dashoffset: (1 - end).toFixed(4),
  }
}

function travelerVisibility(progress: number) {
  const enters = smoothstep(clamp01(progress / 0.08))
  const exits = 1 - smoothstep(clamp01((progress - 0.94) / 0.06))
  return enters * exits
}

function Traveler({
  track,
  progress,
  trailLength,
  prefix,
}: {
  track: TravelerTrack
  progress: number
  trailLength: number
  prefix: "source" | "step" | "center"
}) {
  const safeProgress = clamp01(progress)
  const travelerVisible = travelerVisibility(safeProgress)
  const dash = dashWindow(progress, trailLength)
  const tip = dashWindow(progress, Math.min(0.018, trailLength * 0.22))
  const path = pathFor(track)

  return (
    <g className={`${prefix}-traveler traveler`} style={{ ["--traveler-visible" as string]: travelerVisible.toFixed(4) } as CSSProperties}>
      <path
        className={`traveler-trail ${prefix}-trail ${prefix}-trail-haze`}
        d={path}
        pathLength={1}
        stroke={track.tone}
        strokeDasharray={dash.dasharray}
        strokeDashoffset={dash.dashoffset}
        strokeWidth={(track.width * 3.1).toFixed(2)}
      />
      <path
        className={`traveler-trail ${prefix}-trail ${prefix}-trail-glow`}
        d={path}
        pathLength={1}
        stroke={track.tone}
        strokeDasharray={dash.dasharray}
        strokeDashoffset={dash.dashoffset}
        strokeWidth={(track.width * 1.65).toFixed(2)}
      />
      <path
        className={`traveler-trail ${prefix}-trail ${prefix}-trail-core`}
        d={path}
        pathLength={1}
        stroke={track.tone}
        strokeDasharray={dash.dasharray}
        strokeDashoffset={dash.dashoffset}
        strokeWidth={track.width}
      />
      <path
        className={`traveler-tip ${prefix}-tip`}
        d={path}
        pathLength={1}
        stroke={track.tone}
        strokeDasharray={tip.dasharray}
        strokeDashoffset={tip.dashoffset}
        strokeWidth={(track.width * 1.95).toFixed(2)}
      />
    </g>
  )
}

function SourceTracksLayer({ progress }: { progress: number }) {
  return (
    <g className="source-tracks-layer">
      {SOURCE_TRAVELERS.map((track) => (
        <Traveler
          key={track.id}
          prefix="source"
          progress={smoothstep(clamp01((progress - 0.25 - track.delay) / 2.35))}
          track={track}
          trailLength={0.11}
        />
      ))}
    </g>
  )
}

function StepLinesLayer({ progress }: { progress: number }) {
  return (
    <g className="step-lines-layer">
      {STEP_TRACKS.map((track) => (
        <Traveler
          key={track.id}
          prefix="step"
          progress={smoothstep(clamp01((progress - 2.04 - track.delay) / 0.82))}
          track={track}
          trailLength={0.24}
        />
      ))}
    </g>
  )
}

function CenterTracksLayer({ progress }: { progress: number }) {
  return (
    <g className="center-tracks-layer">
      {CENTER_TRACKS.map((track) => (
        <Traveler
          key={track.id}
          prefix="center"
          progress={smoothstep(clamp01((progress - 2.9 - track.delay) / 1.08))}
          track={track}
          trailLength={0.2}
        />
      ))}
    </g>
  )
}

export function SectionScenes({ motion }: SectionScenesProps) {
  const stage = useMemo(() => {
    const sp = motion.sceneProgress
    const systemOpacity = clamp01((sp - 0.02) * 1.6)
    const sourceVisible = smoothstep(clamp01((sp - 0.12) / 0.45)) * (1 - smoothstep(clamp01((sp - 3.18) / 0.54)))
    const stepVisible = smoothstep(clamp01((sp - 1.98) / 0.36)) * (1 - smoothstep(clamp01((sp - 3.7) / 0.44)))
    const centerVisible = smoothstep(clamp01((sp - 2.78) / 0.42)) * (1 - smoothstep(clamp01((sp - 4.08) / 0.42)))
    const coreVisible = smoothstep(clamp01((sp - 3.46) / 0.4)) * (1 - smoothstep(clamp01((sp - 4.02) / 0.34)))

    return {
      "--scene-progress": sp.toFixed(4),
      "--system-opacity": systemOpacity.toFixed(4),
      "--overall-p": motion.overallProgress.toFixed(4),
      "--source-visible": sourceVisible.toFixed(4),
      "--step-visible": stepVisible.toFixed(4),
      "--center-visible": centerVisible.toFixed(4),
      "--core-visible": coreVisible.toFixed(4),
    } as CSSProperties
  }, [motion.sceneProgress, motion.overallProgress])

  return (
    <div
      aria-hidden="true"
      className="section-scenes pointer-events-none fixed inset-0 z-[1] overflow-hidden"
      data-active-scene={motion.activeId}
      data-reduced-motion={motion.reducedMotion ? "true" : "false"}
      style={stage}
    >
      <div className="source-plan-aura" />
      <svg className="source-plan-svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="source-core-gradient">
            <stop offset="0" stopColor="oklch(0.92 0.10 56)" stopOpacity="0.85" />
            <stop offset="0.34" stopColor="oklch(0.78 0.14 46)" stopOpacity="0.34" />
            <stop offset="1" stopColor="oklch(0.74 0.14 42)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g className="source-plan-grid">
          {Array.from({ length: 9 }).map((_, index) => (
            <line key={`h-${index}`} x1="80" x2="1120" y1={116 + index * 72} y2={116 + index * 72} />
          ))}
          {Array.from({ length: 8 }).map((_, index) => (
            <line key={`v-${index}`} y1="72" y2="728" x1={154 + index * 132} x2={154 + index * 132} />
          ))}
        </g>

        <SourceTracksLayer progress={motion.sceneProgress} />
        <StepLinesLayer progress={motion.sceneProgress} />
        <CenterTracksLayer progress={motion.sceneProgress} />

        <g className="convergence-core" transform={`translate(${CENTER_X} ${CENTER_Y})`}>
          <circle className="core-aura" r="132" fill="url(#source-core-gradient)" />
          <circle className="plan-node-halo" r="22" />
          <circle className="plan-node" r="5.8" />
        </g>
      </svg>
      <div className="source-plan-readability" />
    </div>
  )
}
