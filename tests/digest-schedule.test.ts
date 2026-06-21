import { describe, expect, it } from "vitest"

import {
  isDigestDue,
  isWithinQuietHours,
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

describe("isWithinQuietHours", () => {
  // UTC so the instant's wall-clock hour equals localMinutesOfDay directly.
  const at = (hm: string) => new Date(`2026-06-21T${hm}:00Z`)
  const utc = { timeZone: "UTC" as const }

  it("is never within quiet hours when the window is unset", () => {
    expect(isWithinQuietHours({ now: at("03:00"), ...utc, startHm: null, endHm: null })).toBe(false)
    expect(isWithinQuietHours({ now: at("03:00"), ...utc, startHm: "22:00", endHm: null })).toBe(false)
    expect(isWithinQuietHours({ now: at("03:00"), ...utc, startHm: null, endHm: "07:00" })).toBe(false)
  })

  it("treats a zero-length window as off", () => {
    expect(isWithinQuietHours({ now: at("09:00"), ...utc, startHm: "09:00", endHm: "09:00" })).toBe(false)
  })

  describe("same-day window [13:00, 14:00)", () => {
    const win = { ...utc, startHm: "13:00", endHm: "14:00" }
    it("is inside the window", () => {
      expect(isWithinQuietHours({ now: at("13:30"), ...win })).toBe(true)
    })
    it("includes the start instant and excludes the end instant", () => {
      expect(isWithinQuietHours({ now: at("13:00"), ...win })).toBe(true)
      expect(isWithinQuietHours({ now: at("14:00"), ...win })).toBe(false)
    })
    it("is outside before and after", () => {
      expect(isWithinQuietHours({ now: at("12:59"), ...win })).toBe(false)
      expect(isWithinQuietHours({ now: at("15:00"), ...win })).toBe(false)
    })
  })

  describe("overnight window [22:00, 07:00) wrapping midnight", () => {
    const win = { ...utc, startHm: "22:00", endHm: "07:00" }
    it("is inside late at night and early morning", () => {
      expect(isWithinQuietHours({ now: at("23:00"), ...win })).toBe(true)
      expect(isWithinQuietHours({ now: at("02:00"), ...win })).toBe(true)
      expect(isWithinQuietHours({ now: at("06:59"), ...win })).toBe(true)
    })
    it("includes the start instant and excludes the end instant", () => {
      expect(isWithinQuietHours({ now: at("22:00"), ...win })).toBe(true)
      expect(isWithinQuietHours({ now: at("07:00"), ...win })).toBe(false)
    })
    it("is outside during the day", () => {
      expect(isWithinQuietHours({ now: at("08:30"), ...win })).toBe(false)
      expect(isWithinQuietHours({ now: at("21:59"), ...win })).toBe(false)
    })
  })
})
