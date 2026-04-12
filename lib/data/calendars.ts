// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import type { CalendarListResponse } from "@/types"

export async function getCalendarsData(): Promise<CalendarListResponse["calendars"] | null> {
  try {
    const response = await fetch("/api/calendars", { cache: "no-store" })

    if (response.status === 401) {
      return null
    }

    if (!response.ok) {
      console.warn(`Calendars request failed with status ${response.status}`)
      return null
    }

    const data = (await response.json()) as CalendarListResponse
    return data.calendars
  } catch (error) {
    console.warn("Failed to load calendars", error)
    return null
  }
}

// ##### END BACKEND #####
