import { describe, expect, it } from "vitest"

import {
  isDigestDue,
  localDayKey,
  localMinutesOfDay,
  parseHmToMinutes,
} from "@/lib/digest/schedule"

const LA = "America/Los_Angeles"

describe("parseHmToMinutes", () => {
  it("parses HH:MM into minutes since midnight", () => {
    expect(parseHmToMinutes("08:30")).toBe(510)
    expect(parseHmToMinutes("18:30")).toBe(1110)
    expect(parseHmToMinutes("00:00")).toBe(0)
  })

  it("throws on a malformed time", () => {
    expect(() => parseHmToMinutes("nope")).toThrow()
  })
})

describe("localMinutesOfDay / localDayKey", () => {
  it("resolves UTC instants to the user's local wall-clock (PDT in June = UTC-7)", () => {
    // 2026-06-21T15:30:00Z → 08:30 local in Los Angeles (PDT).
    const now = new Date("2026-06-21T15:30:00Z")
    expect(localMinutesOfDay(now, LA)).toBe(510)
    expect(localDayKey(now, LA)).toBe("2026-06-21")
  })

  it("rolls the local day back across the UTC boundary", () => {
    // 2026-06-21T05:00:00Z → 2026-06-20 22:00 local (still the 20th in LA).
    const now = new Date("2026-06-21T05:00:00Z")
    expect(localDayKey(now, LA)).toBe("2026-06-20")
    expect(localMinutesOfDay(now, LA)).toBe(22 * 60)
  })
})

describe("isDigestDue", () => {
  const target = "08:30"
  const maxCatchupMinutes = 120

  it("is due exactly at the target local time", () => {
    const now = new Date("2026-06-21T15:30:00Z") // 08:30 LA
    expect(isDigestDue({ now, timeZone: LA, targetHm: target, maxCatchupMinutes })).toBe(true)
  })

  it("is NOT due before the target", () => {
    const now = new Date("2026-06-21T14:00:00Z") // 07:00 LA
    expect(isDigestDue({ now, timeZone: LA, targetHm: target, maxCatchupMinutes })).toBe(false)
  })

  it("is still due inside the catch-up window (delayed cron)", () => {
    const now = new Date("2026-06-21T17:00:00Z") // 10:00 LA = target + 90m
    expect(isDigestDue({ now, timeZone: LA, targetHm: target, maxCatchupMinutes })).toBe(true)
  })

  it("is NOT due past the catch-up window (too late → skip, don't send a stale digest)", () => {
    const now = new Date("2026-06-21T18:00:00Z") // 11:00 LA = target + 150m > 120m
    expect(isDigestDue({ now, timeZone: LA, targetHm: target, maxCatchupMinutes })).toBe(false)
  })

  it("evening target works the same way", () => {
    const eveningDue = new Date("2026-06-22T01:30:00Z") // 18:30 LA on the 21st
    expect(isDigestDue({ now: eveningDue, timeZone: LA, targetHm: "18:30", maxCatchupMinutes })).toBe(true)
  })
})
