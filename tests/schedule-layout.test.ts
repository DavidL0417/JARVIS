import { describe, expect, it } from "vitest"

import { buildTimedEventLayoutMap, type TimedLayoutEvent } from "@/lib/schedule-layout"

function event(id: string, startHour: number, durationHours: number): TimedLayoutEvent {
  return { id, title: id, day: 0, startHour, duration: durationHours }
}

describe("buildTimedEventLayoutMap (Apple-style overlaps)", () => {
  it("gives a lone event the full width", () => {
    const layouts = buildTimedEventLayoutMap([event("a", 12, 1)])
    expect(layouts.get("a")).toEqual({ leftPct: 0, widthPct: 100, zIndex: 10 })
  })

  it("keeps non-overlapping events at full width", () => {
    const layouts = buildTimedEventLayoutMap([event("a", 9, 1), event("b", 10, 1)])
    expect(layouts.get("a")?.widthPct).toBe(100)
    expect(layouts.get("b")?.widthPct).toBe(100)
  })

  it("cascades a staggered overlap: nested tile is indented and drawn above", () => {
    // Reference screenshot 4: Event 2 starts 30min into Event 1 — Event 1's title
    // row stays visible, so Event 2 may overlap instead of halving the width.
    const layouts = buildTimedEventLayoutMap([event("e1", 12, 2), event("e2", 12.5, 1)])
    expect(layouts.get("e1")).toEqual({ leftPct: 0, widthPct: 100, zIndex: 10 })
    const nested = layouts.get("e2")!
    expect(nested.leftPct).toBeGreaterThan(0)
    expect(nested.widthPct).toBeLessThan(100)
    expect(nested.widthPct).toBeGreaterThan(80)
    expect(nested.zIndex).toBeGreaterThan(10)
  })

  it("puts same-start events side by side (titles would collide)", () => {
    const layouts = buildTimedEventLayoutMap([event("lunch", 12, 1), event("laundry", 12, 0.5)])
    const widths = [layouts.get("lunch")!.widthPct, layouts.get("laundry")!.widthPct]
    expect(widths).toEqual([50, 50])
    const lefts = [layouts.get("lunch")!.leftPct, layouts.get("laundry")!.leftPct].sort((a, b) => a - b)
    expect(lefts).toEqual([0, 50])
  })

  it("treats starts under the title-gap threshold as side-by-side, not nested", () => {
    const layouts = buildTimedEventLayoutMap([event("a", 12, 1), event("b", 12.25, 1)])
    expect(layouts.get("a")?.widthPct).toBe(50)
    expect(layouts.get("b")?.widthPct).toBe(50)
  })

  it("handles the three-event mix: two same-start columns plus one cascade", () => {
    // Reference screenshot 5: e1/e2 share a start (columns); e3 starts 30min later
    // and cascades over e1's column.
    const layouts = buildTimedEventLayoutMap([
      event("e1", 12, 2),
      event("e2", 12, 1.5),
      event("e3", 12.5, 4),
    ])
    expect(layouts.get("e1")?.widthPct).toBe(50)
    expect(layouts.get("e2")?.widthPct).toBe(50)
    const cascaded = layouts.get("e3")!
    expect(cascaded.zIndex).toBe(11)
    expect(cascaded.widthPct).toBeLessThan(50)
    expect(cascaded.widthPct).toBeGreaterThan(40)
  })

  it("reuses a column at full width once its previous event has ended", () => {
    const layouts = buildTimedEventLayoutMap([
      event("a", 9, 1),
      event("b", 9, 3),
      event("c", 10.25, 0.75),
    ])
    // a and b are side-by-side; c starts after a ends, so it reclaims a's column
    // at depth 0 instead of cascading.
    const reclaimed = layouts.get("c")!
    expect(reclaimed.widthPct).toBe(50)
    expect(reclaimed.zIndex).toBe(10)
    expect(reclaimed.leftPct).toBe(layouts.get("a")!.leftPct)
  })
})
