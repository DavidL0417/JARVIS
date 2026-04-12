// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

const ALL_DAY_START_TIME = "00:00"
const ALL_DAY_END_TIME = "23:59"

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function getReferenceDate(referenceNow?: string | Date | null) {
  if (referenceNow instanceof Date) {
    return Number.isFinite(referenceNow.getTime()) ? referenceNow : new Date()
  }

  if (typeof referenceNow === "string") {
    const parsed = new Date(referenceNow)

    if (Number.isFinite(parsed.getTime())) {
      return parsed
    }
  }

  return new Date()
}

function getDateTimeFormatter(cacheKey: string, formatter: Intl.DateTimeFormat) {
  const existing = formatterCache.get(cacheKey)

  if (existing) {
    return existing
  }

  formatterCache.set(cacheKey, formatter)
  return formatter
}

function getLocalDateKey(date: Date, timeZone: string) {
  const formatter = getDateTimeFormatter(
    `assistant-date:${timeZone}`,
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
  )
  const parts = formatter.formatToParts(date)
  const year = parts.find((part) => part.type === "year")?.value
  const month = parts.find((part) => part.type === "month")?.value
  const day = parts.find((part) => part.type === "day")?.value

  if (!year || !month || !day) {
    throw new Error(`Failed to derive a local date key for timezone ${timeZone}.`)
  }

  return `${year}-${month}-${day}`
}

function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  const nextYear = next.getUTCFullYear()
  const nextMonth = String(next.getUTCMonth() + 1).padStart(2, "0")
  const nextDay = String(next.getUTCDate()).padStart(2, "0")

  return `${nextYear}-${nextMonth}-${nextDay}`
}

function getOffsetMinutes(date: Date, timeZone: string) {
  const formatter = getDateTimeFormatter(
    `assistant-offset:${timeZone}`,
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }),
  )
  const offsetLabel = formatter.formatToParts(date).find((part) => part.type === "timeZoneName")?.value || "GMT"

  if (offsetLabel === "GMT") {
    return 0
  }

  const match = offsetLabel.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/)

  if (!match) {
    throw new Error(`Unsupported timezone offset label "${offsetLabel}" for ${timeZone}.`)
  }

  const sign = match[1] === "-" ? -1 : 1
  const hours = Number(match[2])
  const minutes = Number(match[3] ?? "0")

  return sign * (hours * 60 + minutes)
}

function zonedDateTimeToUtc(dateKey: string, time: string, timeZone: string) {
  const [year, month, day] = dateKey.split("-").map(Number)
  const [hours, minutes] = time.split(":").map(Number)
  const localUtcGuess = Date.UTC(year, month - 1, day, hours, minutes, 0, 0)
  let currentMs = localUtcGuess

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offsetMinutes = getOffsetMinutes(new Date(currentMs), timeZone)
    const nextMs = localUtcGuess - offsetMinutes * 60_000

    if (nextMs === currentMs) {
      break
    }

    currentMs = nextMs
  }

  return new Date(currentMs)
}

function resolveTimeLabel(text: string, defaultTime: string | null = null) {
  const normalized = text.toLowerCase()
  const explicitTimeMatch = normalized.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/)

  if (explicitTimeMatch) {
    let hours = Number(explicitTimeMatch[1])
    const minutes = Number(explicitTimeMatch[2] ?? "0")
    const meridiem = explicitTimeMatch[3]

    if (meridiem === "pm" && hours < 12) {
      hours += 12
    }

    if (meridiem === "am" && hours === 12) {
      hours = 0
    }

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
  }

  if (/\bnoon\b/.test(normalized)) return "12:00"
  if (/\bmidnight\b/.test(normalized)) return "00:00"
  if (/\bmorning\b/.test(normalized)) return "09:00"
  if (/\bafternoon\b/.test(normalized)) return "14:00"
  if (/\bevening\b/.test(normalized)) return "18:00"
  if (/\btonight\b|\bnight\b/.test(normalized)) return "20:00"

  return defaultTime
}

function resolveMonthDayDateKey(text: string, now: Date, timeZone: string) {
  const match = text
    .toLowerCase()
    .match(
      /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/,
    )

  if (!match) {
    return null
  }

  const monthAliases: Record<string, number> = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
  }

  const monthIndex = monthAliases[match[1]]
  const day = Number(match[2])
  const todayLocal = getLocalDateKey(now, timeZone)
  const [currentYear, currentMonth, currentDay] = todayLocal.split("-").map(Number)

  let year = currentYear
  const currentMonthIndex = currentMonth - 1

  if (monthIndex < currentMonthIndex || (monthIndex === currentMonthIndex && day < currentDay)) {
    year += 1
  }

  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function resolveWeekdayDateKey(text: string, now: Date, timeZone: string) {
  const match = text
    .toLowerCase()
    .match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/)

  if (!match) {
    return null
  }

  const weekdayIndex: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  }

  const localDateKey = getLocalDateKey(now, timeZone)
  const currentDayIndex = new Date(`${localDateKey}T12:00:00Z`).getUTCDay()
  const targetDayIndex = weekdayIndex[match[1]]
  let delta = targetDayIndex - currentDayIndex

  if (delta < 0) {
    delta += 7
  }

  return addDaysToDateKey(localDateKey, delta)
}

function resolveDateKeyFromText(text: string, now: Date, timeZone: string) {
  const normalized = text.toLowerCase()

  if (/\btomorrow\b/.test(normalized)) {
    return addDaysToDateKey(getLocalDateKey(now, timeZone), 1)
  }

  if (/\btoday\b|\btonight\b/.test(normalized)) {
    return getLocalDateKey(now, timeZone)
  }

  return (
    resolveMonthDayDateKey(text, now, timeZone) ||
    resolveWeekdayDateKey(text, now, timeZone)
  )
}

export function normalizeNullableText(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function resolveNaturalDateTime(
  text: string | null,
  timeZone: string,
  options: { defaultTime?: string | null; referenceNow?: string | Date | null } = {},
) {
  const normalizedText = normalizeNullableText(text)

  if (!normalizedText) {
    return null
  }

  const directDate = new Date(normalizedText)

  if (Number.isFinite(directDate.getTime())) {
    return directDate.toISOString()
  }

  const now = getReferenceDate(options.referenceNow)
  const dateKey = resolveDateKeyFromText(normalizedText, now, timeZone)
  const timeValue = resolveTimeLabel(normalizedText, options.defaultTime ?? null)

  if (!dateKey || !timeValue) {
    return null
  }

  return zonedDateTimeToUtc(dateKey, timeValue, timeZone).toISOString()
}

export function resolveAllDayRange(
  text: string | null,
  timeZone: string,
  options: { referenceNow?: string | Date | null } = {},
) {
  const normalizedText = normalizeNullableText(text)

  if (!normalizedText) {
    return null
  }

  const now = getReferenceDate(options.referenceNow)
  const dateKey = resolveDateKeyFromText(normalizedText, now, timeZone)

  if (!dateKey) {
    return null
  }

  return {
    start: zonedDateTimeToUtc(dateKey, ALL_DAY_START_TIME, timeZone).toISOString(),
    end: zonedDateTimeToUtc(dateKey, ALL_DAY_END_TIME, timeZone).toISOString(),
  }
}

export function addMinutes(timestamp: string, minutes: number) {
  return new Date(new Date(timestamp).getTime() + minutes * 60_000).toISOString()
}

// ##### END BACKEND #####
