-- Cross-source dedup support: store the raw iCalendar UID on mirrored events so the
-- same underlying event can be matched when it arrives via BOTH Google Calendar
-- (a subscribed Apple calendar) and iCloud CalDAV. Nullable; populated going forward
-- by both read paths. The existing hashed external_event_id is kept for per-source
-- identity/reconciliation.
ALTER TABLE schedule_events ADD COLUMN IF NOT EXISTS ical_uid text;

-- Optional: helps the dedup pass and future UID lookups without scanning.
CREATE INDEX IF NOT EXISTS schedule_events_user_ical_uid_idx
  ON schedule_events (user_id, ical_uid)
  WHERE ical_uid IS NOT NULL;
