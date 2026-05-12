"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { SectionScenes } from "@/components/landing/section-scenes"
import { TimeSpine } from "@/components/landing/time-spine"

export const LANDING_SCENES = ["hero", "problem", "how", "not", "cta"] as const

export type LandingSceneId = (typeof LANDING_SCENES)[number]

export interface LandingMotionSection {
  id: LandingSceneId
  elementId: string
  index: string
  label: string
  topRatio: number
  heightRatio: number
  startScroll: number
  endScroll: number
}

export interface LandingMotionState {
  activeId: LandingSceneId
  activeSection: LandingMotionSection | null
  activeProgress: number
  easedProgress: number
  overallProgress: number
  /** Continuous 0..N progress that interpolates between section anchors — never plateaus. */
  sceneProgress: number
  reducedMotion: boolean
  sections: LandingMotionSection[]
}

const DEFAULT_SECTION: LandingMotionSection = {
  id: "hero",
  elementId: "section-hero",
  index: "01",
  label: "start",
  topRatio: 0,
  heightRatio: 1,
  startScroll: 0,
  endScroll: 1,
}

const DEFAULT_MOTION: LandingMotionState = {
  activeId: "hero",
  activeSection: DEFAULT_SECTION,
  activeProgress: 0,
  easedProgress: 0,
  overallProgress: 0,
  sceneProgress: 0,
  reducedMotion: false,
  sections: [DEFAULT_SECTION],
}

function smoothstep(value: number) {
  return value * value * (3 - 2 * value)
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function computeSceneProgress(scrollY: number, sections: LandingMotionSection[]) {
  if (sections.length === 0) return 0
  const anchors = sections.map((s, i) => ({
    p: i,
    y: i === 0 ? 0 : s.startScroll,
  }))
  const last = sections[sections.length - 1]
  anchors.push({ p: sections.length, y: last.endScroll })

  if (scrollY <= anchors[0].y) return anchors[0].p
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const a = anchors[i]
    const b = anchors[i + 1]
    if (scrollY <= b.y) {
      const span = Math.max(1, b.y - a.y)
      return a.p + (scrollY - a.y) / span
    }
  }
  return anchors[anchors.length - 1].p
}

function buildMotionState(
  sections: LandingMotionSection[],
  scrollY: number,
  viewportH: number,
  documentH: number,
  reducedMotion: boolean,
): LandingMotionState {
  const scrollMax = Math.max(1, documentH - viewportH)
  const overallProgress = clamp01(scrollY / scrollMax)
  const measured = sections.length > 0 ? sections : [DEFAULT_SECTION]

  let activeSection = measured[0]
  let activeProgress = 0

  for (const section of measured) {
    if (scrollY < section.startScroll) break
    activeSection = section
    const range = Math.max(1, section.endScroll - section.startScroll)
    activeProgress = clamp01((scrollY - section.startScroll) / range)
  }

  return {
    activeId: activeSection.id,
    activeSection,
    activeProgress,
    easedProgress: smoothstep(activeProgress),
    overallProgress,
    sceneProgress: computeSceneProgress(scrollY, measured),
    reducedMotion,
    sections: measured,
  }
}

function measureSections() {
  const viewportH = window.innerHeight
  const documentH = document.documentElement.scrollHeight
  const scrollMax = Math.max(1, documentH - viewportH)
  const nodes = document.querySelectorAll<HTMLElement>("[data-spine-section]")

  return Array.from(nodes)
    .map((el, fallbackIndex) => {
      const id = el.dataset.spineSection as LandingSceneId
      const top = el.getBoundingClientRect().top + window.scrollY
      const height = el.offsetHeight

      return {
        id,
        elementId: el.id || `section-${id || fallbackIndex}`,
        index: el.dataset.spineIndex || String(fallbackIndex + 1).padStart(2, "0"),
        label: el.dataset.spineLabel || id || "",
        top,
        height,
      }
    })
    .filter((section) => LANDING_SCENES.includes(section.id))
    .sort((a, b) => a.top - b.top)
    .map((section, index, all): LandingMotionSection => {
      const blockTop = index === 0 ? 0 : section.top
      const nextTop = all[index + 1]?.top ?? documentH
      const startScroll = Math.max(0, section.top - viewportH * 0.5)
      const endScroll = Math.min(scrollMax, section.top + section.height - viewportH * 0.5)

      return {
        id: section.id,
        elementId: section.elementId,
        index: section.index,
        label: section.label,
        topRatio: clamp01(blockTop / Math.max(1, documentH)),
        heightRatio: Math.max(0, nextTop - blockTop) / Math.max(1, documentH),
        startScroll,
        endScroll: Math.max(startScroll + 1, endScroll),
      }
    })
}

export function LandingMotion() {
  const [motion, setMotion] = useState<LandingMotionState>(DEFAULT_MOTION)
  const measuredRef = useRef<LandingMotionSection[]>([DEFAULT_SECTION])
  const rafRef = useRef(0)

  useEffect(() => {
    if (typeof window === "undefined") return

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    const update = () => {
      rafRef.current = 0
      const next = buildMotionState(
        measuredRef.current,
        window.scrollY,
        window.innerHeight,
        document.documentElement.scrollHeight,
        reducedMotion,
      )
      setMotion((previous) => {
        const sameSection = previous.activeId === next.activeId
        const closeEnough =
          Math.abs(previous.activeProgress - next.activeProgress) < 0.0002 &&
          Math.abs(previous.overallProgress - next.overallProgress) < 0.0002 &&
          Math.abs(previous.sceneProgress - next.sceneProgress) < 0.0008
        if (sameSection && closeEnough && previous.sections === next.sections) return previous
        return next
      })
    }

    const schedule = () => {
      if (rafRef.current) return
      rafRef.current = window.requestAnimationFrame(update)
    }

    const measure = () => {
      measuredRef.current = measureSections()
      schedule()
    }

    measure()

    const observer = new ResizeObserver(measure)
    document.querySelectorAll<HTMLElement>("[data-spine-section]").forEach((el) => observer.observe(el))

    window.addEventListener("resize", measure)
    window.addEventListener("scroll", schedule, { passive: true })

    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", schedule)
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const stableMotion = useMemo(() => motion, [motion])

  return (
    <>
      <SectionScenes motion={stableMotion} />
      <TimeSpine motion={stableMotion} />
      <ScrollFade overallProgress={stableMotion.overallProgress} />
    </>
  )
}

interface ScrollFadeProps {
  overallProgress: number
}

function ScrollFade({ overallProgress }: ScrollFadeProps) {
  const fadeProgress = smoothstep(clamp01((overallProgress - 0.79) / 0.19))
  const opacity = fadeProgress * 0.84

  useEffect(() => {
    document.documentElement.style.setProperty("--landing-scroll-fade-opacity", opacity.toFixed(4))
    return () => {
      document.documentElement.style.removeProperty("--landing-scroll-fade-opacity")
    }
  }, [opacity])

  return null
}
