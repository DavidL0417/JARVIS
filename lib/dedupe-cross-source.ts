import { titlesLookSimilar } from "@/lib/dedupe"
import type { ScheduleEvent, SyncOrigin } from "@/types"

// When a user subscribes an Apple/iCloud calendar INTO Google, the same underlying
// event is mirrored into schedule_events twice — once via the Google read
// (last_synced_from='gcal') and once via the iCloud CalDAV read ('caldav'). This
// pass suppresses the duplicate at READ time (filter only — both DB rows survive so
// each source's stale-reconciler stays correct).
//
// Tier 1 (primary): exact iCal UID + occurrence start. UID survives the
//   subscription bridge (RFC 5545). Start is required because singleEvents=true
//   gives every recurring occurrence the SAME UID — keying on UID alone would
//   collapse a whole series to one event.
// Tier 2 (fallback): same start+end+all-day AND a similar title, for the cross-source
//   pair only. Catches Google-rewritten UIDs (@google.com) and edited instances.
//
// Default preference: keep the Google copy, drop the matching CalDAV copy. Flip
// PREFERRED_SOURCE/SUPPRESSED_SOURCE to reverse.
const PREFERRED_SOURCE: SyncOrigin = "gcal"
const SUPPRESSED_SOURCE: SyncOrigin = "caldav"

function norm(value: string): string {
  return value.trim().toLowerCase()
}

function uidKey(event: ScheduleEvent): string | null {
  return event.icalUid ? `${norm(event.icalUid)}|${event.start}` : null
}

function timeKey(event: ScheduleEvent): string {
  return `${event.start}|${event.end}|${event.allDay ? "1" : "0"}`
}

export function dedupeCrossSourceEvents(events: ScheduleEvent[]): ScheduleEvent[] {
  // Cheap fast path: dedup is only possible when both sources are present.
  let hasPreferred = false
  let hasSuppressed = false
  for (const event of events) {
    if (event.lastSyncedFrom === PREFERRED_SOURCE) hasPreferred = true
    else if (event.lastSyncedFrom === SUPPRESSED_SOURCE) hasSuppressed = true
  }
  if (!hasPreferred || !hasSuppressed) {
    return events
  }

  const preferredUidKeys = new Set<string>()
  const preferredByTime = new Map<string, ScheduleEvent[]>()
  for (const event of events) {
    if (event.lastSyncedFrom !== PREFERRED_SOURCE) continue
    const key = uidKey(event)
    if (key) preferredUidKeys.add(key)
    const bucketKey = timeKey(event)
    const bucket = preferredByTime.get(bucketKey)
    if (bucket) bucket.push(event)
    else preferredByTime.set(bucketKey, [event])
  }

  return events.filter((event) => {
    if (event.lastSyncedFrom !== SUPPRESSED_SOURCE) {
      return true
    }
    // Tier 1: exact UID + start match against a preferred-source event.
    const key = uidKey(event)
    if (key && preferredUidKeys.has(key)) {
      return false
    }
    // Tier 2: same start/end/all-day window with a similar title.
    const sameTime = preferredByTime.get(timeKey(event))
    if (sameTime && sameTime.some((other) => titlesLookSimilar(event.title, other.title))) {
      return false
    }
    return true
  })
}
