"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

interface SectionRevealProps {
  children: ReactNode
  className?: string
  as?: "section" | "div" | "footer" | "header" | "article"
  /**
   * If true, run a quick fade in once visible (no scroll-sync).
   * Default false: content fades in from a slightly larger offset once it enters the viewport.
   */
  oneShot?: boolean
}

export function SectionReveal({
  children,
  className,
  as: Component = "div",
  oneShot = false,
}: SectionRevealProps) {
  const ref = useRef<HTMLElement | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const isNearViewport = () => {
      const rect = node.getBoundingClientRect()
      return rect.top < window.innerHeight * 0.95 && rect.bottom > 0
    }

    const revealIfNearViewport = () => {
      if (document.visibilityState === "visible" && isNearViewport()) {
        setVisible(true)
      }
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduced || !("IntersectionObserver" in window)) {
      setVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setVisible(true)
        observer.disconnect()
      },
      {
        root: null,
        rootMargin: oneShot ? "0px 0px -12% 0px" : "0px 0px -18% 0px",
        threshold: 0.01,
      },
    )

    observer.observe(node)
    window.addEventListener("pageshow", revealIfNearViewport)
    document.addEventListener("visibilitychange", revealIfNearViewport)
    window.requestAnimationFrame(revealIfNearViewport)

    return () => {
      observer.disconnect()
      window.removeEventListener("pageshow", revealIfNearViewport)
      document.removeEventListener("visibilitychange", revealIfNearViewport)
    }
  }, [oneShot])

  return (
    <Component
      ref={ref as never}
      className={className}
      data-visible={visible}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : `translateY(${oneShot ? 28 : 96}px)`,
        transition:
          "opacity 700ms cubic-bezier(0.22, 1, 0.36, 1), transform 920ms cubic-bezier(0.16, 1, 0.3, 1)",
        willChange: visible ? "auto" : "opacity, transform",
      }}
    >
      {children}
    </Component>
  )
}
