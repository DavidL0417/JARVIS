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

    return () => {
      observer.disconnect()
    }
  }, [oneShot])

  return (
    <Component
      ref={ref as never}
      className={className}
      data-visible={visible}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : `translateY(${oneShot ? 24 : 40}px)`,
        transition: "opacity 520ms ease-out, transform 620ms cubic-bezier(0.22, 1, 0.36, 1)",
        willChange: visible ? "auto" : "opacity, transform",
      }}
    >
      {children}
    </Component>
  )
}
