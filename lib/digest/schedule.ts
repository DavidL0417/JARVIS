// Timezone-aware "is it time to send?" logic for the digest dispatcher.
//
// The dispatcher cron fires on a fixed UTC cadence (every ~30 min). Each tick it
// resolves the user's CURRENT local wall-clock and decides whether a digest of a
// given kind is due — so the user gets it at the same LOCAL time year-round,
// DST included, without per-timezone cron entries. Idempotency (one send per day)
// is enforced separately by the outbox dedup key built from `localDayKey`.

/** Minutes-since-midnight for an "HH:MM" string (e.g. "08:30" → 510). */
export function parseHmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    throw new Error(`Invalid HH:MM time "${hm}".`)
  }
  return h * 60 + m
}

/** The user's local minutes-since-midnight at instant `now`, in `timeZone`. */
export function localMinutesOfDay(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now)
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0")
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0")
  return hour * 60 + minute
}

/** The user's local calendar day (YYYY-MM-DD) at `now`, for the per-day dedup key. */
export function localDayKey(now: Date, timeZone: string): string {
  // en-CA renders as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

/**
 * True when `now` is at or after the target local time and still within the
 * catch-up window for today. Combined with the per-day dedup key, exactly one
 * send fires per day even though several cron ticks fall inside the window.
 */
export function isDigestDue(input: {
  now: Date
  timeZone: string
  targetHm: string
  maxCatchupMinutes: number
}): boolean {
  const current = localMinutesOfDay(input.now, input.timeZone)
  const target = parseHmToMinutes(input.targetHm)
  return current >= target && current < target + input.maxCatchupMinutes
}

/**
 * True when the user's current local time falls inside the quiet-hours window —
 * a "don't text me" gate layered on top of pause. Null start/end means no quiet
 * hours (never suppressed). The window may wrap past midnight: when start > end
 * (e.g. 22:00–07:00) it spans the night, so membership is `current >= start ||
 * current < end`. The window is half-open [start, end); a zero-length window
 * (start === end) is treated as off.
 */
export function isWithinQuietHours(input: {
  now: Date
  timeZone: string
  startHm: string | null
  endHm: string | null
}): boolean {
  if (!input.startHm || !input.endHm) {
    return false
  }
  const current = localMinutesOfDay(input.now, input.timeZone)
  const start = parseHmToMinutes(input.startHm)
  const end = parseHmToMinutes(input.endHm)
  if (start === end) {
    return false
  }
  if (start < end) {
    return current >= start && current < end
  }
  return current >= start || current < end
}
