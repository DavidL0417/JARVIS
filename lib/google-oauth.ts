export const GOOGLE_CALENDAR_READONLY_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"
export const GOOGLE_CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events"
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"

export const GOOGLE_SOURCE_SCOPES = [
  GOOGLE_CALENDAR_READONLY_SCOPE,
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  GMAIL_READONLY_SCOPE,
].join(" ")

export function hasOAuthScope(scope: string | null | undefined, requiredScope: string) {
  return Boolean(scope?.split(/\s+/).includes(requiredScope))
}
