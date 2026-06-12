import { describe, expect, it } from "vitest"

import { normalizeHexColor, withAlpha } from "@/lib/color"

describe("normalizeHexColor", () => {
  it("collapses 8-digit Apple/CalDAV #RRGGBBAA to #RRGGBB", () => {
    expect(normalizeHexColor("#08FFDDFF")).toBe("#08ffdd")
    expect(normalizeHexColor("#0096FFFF")).toBe("#0096ff")
  })

  it("passes 6-digit colors through (lowercased)", () => {
    expect(normalizeHexColor("#42d692")).toBe("#42d692")
    expect(normalizeHexColor("#FF8D28")).toBe("#ff8d28")
  })

  it("expands 3-digit and drops alpha from 4-digit shorthand", () => {
    expect(normalizeHexColor("#abc")).toBe("#aabbcc")
    expect(normalizeHexColor("#abcf")).toBe("#aabbcc")
  })

  it("tolerates a missing leading #", () => {
    expect(normalizeHexColor("08ffdd")).toBe("#08ffdd")
  })

  it("returns null for empty or unparseable input", () => {
    expect(normalizeHexColor(null)).toBeNull()
    expect(normalizeHexColor(undefined)).toBeNull()
    expect(normalizeHexColor("")).toBeNull()
    expect(normalizeHexColor("oklch(0.5 0.1 200)")).toBeNull()
    expect(normalizeHexColor("#12345")).toBeNull()
  })
})

describe("withAlpha", () => {
  it("produces a valid 8-digit color from an 8-digit base (the fill-dropping bug)", () => {
    // The bug was appending an alpha pair to an already-8-digit hex, yielding a
    // 10-digit value the browser silently discards. The base must collapse first.
    expect(withAlpha("#08FFDDFF", "45")).toBe("#08ffdd45")
    expect(withAlpha("#42d692", "22")).toBe("#42d69222")
  })

  it("returns null when the base color is unparseable", () => {
    expect(withAlpha("not-a-color", "45")).toBeNull()
  })
})
