// Calendar-date helpers shared by the Google and CalDAV event writers. All-day
// events are anchored to the user's LOCAL calendar date, not a slice of a UTC
// instant (an evening local time rolls onto the next UTC day otherwise).

// Format a UTC ISO instant to its YYYY-MM-DD calendar date IN the given timezone
// (en-CA yields ISO-style YYYY-MM-DD).
export function localDateKeyFromIso(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso))
}

// Add days to a YYYY-MM-DD key using pure calendar arithmetic (no timezone math).
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number)
  const dt = new Date(Date.UTC(year, month - 1, day))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}
