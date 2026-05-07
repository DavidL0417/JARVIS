"use client"

import { useEffect, useState } from "react"

const MONTH_SHORT = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

function getZoneLabel(now: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" })
  const part = formatter.formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? ""
  return part.toLowerCase()
}

function format12h(hour: number, minute: number) {
  const ampm = hour >= 12 ? "pm" : "am"
  const display = hour % 12 || 12
  return `${display}:${String(minute).padStart(2, "0")} ${ampm}`
}

export function LiveClock() {
  const [date, setDate] = useState("·· ···")
  const [time, setTime] = useState("··:·· ··")
  const [zone, setZone] = useState("···")

  useEffect(() => {
    const now = new Date()
    const targetHour = now.getHours()
    const targetMinute = now.getMinutes()
    setDate(`${String(now.getDate()).padStart(2, "0")} ${MONTH_SHORT[now.getMonth()]}`)
    setZone(getZoneLabel(now))

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const cancelToken = { cancelled: false }

    if (reduced) {
      setTime(format12h(targetHour, targetMinute))
    } else {
      setTime(format12h(0, 0))
      void (async () => {
        const { animate, eases, utils } = await import("animejs")
        if (cancelToken.cancelled) return
        const counter = { hour: 0, minute: 0 }
        animate(counter, {
          hour: targetHour,
          minute: targetMinute,
          duration: 1100,
          ease: eases.outQuart,
          modifier: utils.round(0),
          onUpdate: () => {
            if (cancelToken.cancelled) return
            setTime(format12h(Math.round(counter.hour), Math.round(counter.minute)))
          },
        })
      })()
    }

    const interval = window.setInterval(() => {
      const tick = new Date()
      setTime(format12h(tick.getHours(), tick.getMinutes()))
    }, 30_000)

    return () => {
      cancelToken.cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  return (
    <span
      className="num inline-flex items-center gap-2 text-[12px] uppercase tracking-[0.12em] text-muted-foreground"
      aria-live="off"
      suppressHydrationWarning
    >
      <span>{date}</span>
      <span aria-hidden="true">·</span>
      <span>{time}</span>
      <span aria-hidden="true">·</span>
      <span>{zone}</span>
    </span>
  )
}
