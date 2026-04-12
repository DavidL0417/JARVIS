import type { ScheduleEvent } from "@/types"

export const PLACEHOLDER_SELECTED_DATE_LOCAL = "2026-04-06T12:00:00"
export const PLACEHOLDER_MONTH_START_LOCAL = "2026-04-01T12:00:00"

type PlaceholderCalendarTemplate = {
  calendarId: string
  title: string
  startLocal: string
  endLocal: string
  location?: string
}

const PLACEHOLDER_CALENDAR_TEMPLATES: PlaceholderCalendarTemplate[] = [
  { calendarId: "cal-1", title: "PAD Meeting", location: "University Hall", startLocal: "2026-04-06T18:00:00", endLocal: "2026-04-06T20:30:00" },
  { calendarId: "cal-1", title: "Dinner w Evan", startLocal: "2026-04-09T18:00:00", endLocal: "2026-04-09T19:00:00" },
  { calendarId: "cal-1", title: "Hotpot", startLocal: "2026-04-10T18:00:00", endLocal: "2026-04-10T21:00:00" },
  { calendarId: "cal-2", title: "Innovation Lab", location: "Microsoft Tech", startLocal: "2026-04-10T13:00:00", endLocal: "2026-04-10T14:00:00" },
  { calendarId: "cal-3", title: "MATH 240-0", location: "Lunt 105", startLocal: "2026-04-06T10:00:00", endLocal: "2026-04-06T11:00:00" },
  { calendarId: "cal-3", title: "HISTORY 382", location: "Locy Hall 111", startLocal: "2026-04-06T11:00:00", endLocal: "2026-04-06T12:00:00" },
  { calendarId: "cal-3", title: "PHIL 101-8 Office Hours", location: "Crowe 3-178", startLocal: "2026-04-06T15:00:00", endLocal: "2026-04-06T15:30:00" },
  { calendarId: "cal-3", title: "PHIL 101-8 (seminar)", location: "Shepard Hall", startLocal: "2026-04-06T16:00:00", endLocal: "2026-04-06T17:00:00" },
  { calendarId: "cal-3", title: "MATH 240-0", location: "Lunt Hall 103", startLocal: "2026-04-07T10:00:00", endLocal: "2026-04-07T11:00:00" },
  { calendarId: "cal-3", title: "LEGAL_ST 221-0", location: "Harris Hall", startLocal: "2026-04-07T13:00:00", endLocal: "2026-04-07T14:00:00" },
  { calendarId: "cal-3", title: "COMP_SCI 397-0 (seminar)", location: "RB135 - Tech", startLocal: "2026-04-07T14:30:00", endLocal: "2026-04-07T17:00:00" },
  { calendarId: "cal-3", title: "HISTORY 382", location: "Locy Hall 111", startLocal: "2026-04-08T11:00:00", endLocal: "2026-04-08T12:00:00" },
  { calendarId: "cal-3", title: "PHIL 101-8 Office Hours", location: "Crowe 3-178", startLocal: "2026-04-08T15:00:00", endLocal: "2026-04-08T15:30:00" },
  { calendarId: "cal-3", title: "PHIL 101-8 (seminar)", location: "Shepard Hall", startLocal: "2026-04-08T16:00:00", endLocal: "2026-04-08T17:00:00" },
  { calendarId: "cal-3", title: "LEGAL_ST 221-0", location: "Harris Hall", startLocal: "2026-04-09T13:00:00", endLocal: "2026-04-09T14:00:00" },
  { calendarId: "cal-3", title: "LEGAL_ST 221", location: "Kresge Center", startLocal: "2026-04-09T16:00:00", endLocal: "2026-04-09T17:00:00" },
  { calendarId: "cal-3", title: "MATH 240-0", location: "Lunt 105", startLocal: "2026-04-10T10:00:00", endLocal: "2026-04-10T11:00:00" },
  { calendarId: "cal-3", title: "HISTORY 382", location: "Locy Hall 111", startLocal: "2026-04-10T11:00:00", endLocal: "2026-04-10T12:00:00" },
  { calendarId: "cal-3", title: "HISTORY 382 Lab", location: "Kresge Center", startLocal: "2026-04-10T14:00:00", endLocal: "2026-04-10T15:00:00" },
  { calendarId: "cal-4", title: "Project Vela Meeting", startLocal: "2026-04-06T16:30:00", endLocal: "2026-04-06T17:00:00" },
  { calendarId: "cal-4", title: "Project Vela Sprint", startLocal: "2026-04-07T16:30:00", endLocal: "2026-04-07T18:00:00" },
  { calendarId: "cal-4", title: "Project Vela Demo", startLocal: "2026-04-08T16:30:00", endLocal: "2026-04-08T17:00:00" },
  { calendarId: "cal-4", title: "Project Vela Review", startLocal: "2026-04-09T16:30:00", endLocal: "2026-04-09T17:00:00" },
  { calendarId: "cal-4", title: "Project Vela Planning", startLocal: "2026-04-10T16:30:00", endLocal: "2026-04-10T17:00:00" },
  { calendarId: "cal-5", title: "Feiyi Recital", location: "Galvin Recital", startLocal: "2026-04-08T18:00:00", endLocal: "2026-04-08T19:00:00" },
]

function toStablePlaceholderId(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
}

function toIsoString(localDateTime: string) {
  return new Date(localDateTime).toISOString()
}

export function createPlaceholderCalendarEvents(userId: string): ScheduleEvent[] {
  return PLACEHOLDER_CALENDAR_TEMPLATES.map((template, index) => ({
    id: toStablePlaceholderId(index + 1),
    userId,
    taskId: null,
    title: template.title,
    start: toIsoString(template.startLocal),
    end: toIsoString(template.endLocal),
    source: "calendar",
    status: null,
    location: template.location ?? null,
    externalEventId: null,
    isImmutable: true,
    calendarId: template.calendarId,
  }))
}
