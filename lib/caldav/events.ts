import ICAL from "ical.js"

import type { Priority, ScheduleEvent } from "@/types"

export interface CalDavParsedEvent {
  uid: string
  title: string
  start: string
  end: string
  allDay: boolean
  location: string | null
  recurrenceKey: string | null
}

const MAX_OCCURRENCES_PER_EVENT = 500

function normalizeText(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : fallback
}

function isCancelled(component: ICAL.Component) {
  const status = component.getFirstPropertyValue("status")
  return typeof status === "string" && status.toUpperCase() === "CANCELLED"
}

function timeToIso(time: ICAL.Time, allDayEnd = false) {
  const timestamp = time.isDate
    ? Date.UTC(time.year, time.month - 1, time.day) - (allDayEnd ? 60_000 : 0)
    : time.toJSDate().getTime()
  return new Date(timestamp).toISOString()
}

function overlapsRange(start: string, end: string, rangeStart: Date, rangeEnd: Date) {
  return new Date(end).getTime() >= rangeStart.getTime() && new Date(start).getTime() <= rangeEnd.getTime()
}

function mapOccurrence(
  event: ICAL.Event,
  occurrence: {
    startDate: ICAL.Time
    endDate: ICAL.Time
    item: ICAL.Event
  },
  rangeStart: Date,
  rangeEnd: Date,
): CalDavParsedEvent | null {
  const allDay = occurrence.startDate.isDate
  const start = timeToIso(occurrence.startDate)
  const end = timeToIso(occurrence.endDate, allDay)

  if (!overlapsRange(start, end, rangeStart, rangeEnd)) {
    return null
  }

  return {
    uid: normalizeText(event.uid, "caldav-event"),
    title: normalizeText(occurrence.item.summary, "Untitled event"),
    start,
    end,
    allDay,
    location: normalizeText(occurrence.item.location, "") || null,
    recurrenceKey: occurrence.startDate.toICALString(),
  }
}

export function parseCalDavEventsFromIcs(input: {
  calendarData: string
  rangeStart: Date
  rangeEnd: Date
}): CalDavParsedEvent[] {
  if (!input.calendarData.trim()) {
    return []
  }

  const component = new ICAL.Component(ICAL.parse(input.calendarData))
  const eventComponents = component.getAllSubcomponents("vevent")
  const events: CalDavParsedEvent[] = []

  for (const eventComponent of eventComponents) {
    if (isCancelled(eventComponent)) {
      continue
    }

    const event = new ICAL.Event(eventComponent)

    if (event.isRecurrenceException()) {
      continue
    }

    if (!event.isRecurring()) {
      const mapped = mapOccurrence(
        event,
        {
          startDate: event.startDate,
          endDate: event.endDate,
          item: event,
        },
        input.rangeStart,
        input.rangeEnd,
      )

      if (mapped) {
        events.push({
          ...mapped,
          recurrenceKey: null,
        })
      }

      continue
    }

    const iterator = event.iterator()
    let count = 0
    let next = iterator.next()

    while (next && count < MAX_OCCURRENCES_PER_EVENT) {
      const details = event.getOccurrenceDetails(next)
      const mapped = mapOccurrence(event, details, input.rangeStart, input.rangeEnd)

      if (mapped) {
        events.push(mapped)
      }

      if (details.startDate.toJSDate().getTime() > input.rangeEnd.getTime()) {
        break
      }

      count += 1
      next = iterator.next()
    }
  }

  return events.sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime())
}

export function toCalDavScheduleEvent(input: {
  parsedEvent: CalDavParsedEvent
  userId: string
  calendarId: string
  externalEventId: string
  priority?: Priority
  isImmutable?: boolean
}): ScheduleEvent {
  return {
    id: crypto.randomUUID(),
    userId: input.userId,
    taskId: null,
    title: input.parsedEvent.title,
    start: input.parsedEvent.start,
    end: input.parsedEvent.end,
    source: "calendar",
    priority: input.priority ?? "medium",
    status: null,
    location: input.parsedEvent.location,
    externalEventId: input.externalEventId,
    gcalEventId: null,
    lastSyncedFrom: "caldav",
    isImmutable: input.isImmutable ?? true,
    isCheckedIn: true,
    allDay: input.parsedEvent.allDay,
    calendarId: input.calendarId,
    planId: null,
  }
}
