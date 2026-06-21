// Proactive-digest configuration.
//
// Phase 2 shipped on hard-coded DIGEST_DEFAULTS (operator-only). Phase 3 sources
// per-user overrides from the `preferences` table (enable flags + send times +
// quiet hours) via resolveDigestConfig; DIGEST_DEFAULTS is the per-field fallback
// when a user has no preferences row yet.

import type { UserPreferences } from "@/types"

export interface DigestConfig {
  morningEnabled: boolean
  eveningEnabled: boolean
  /** Local wall-clock send time, "HH:MM" in the user's timezone. */
  morningTime: string
  eveningTime: string
  /**
   * How long after the target a delayed cron may still fire today's digest.
   * Bounds lateness if some cron ticks were missed, while the per-(user,kind,day)
   * dedup key guarantees exactly one send.
   */
  maxCatchupMinutes: number
  /**
   * "Don't text me" window, "HH:MM"–"HH:MM" in the user's timezone. Null means no
   * quiet hours. The window may wrap past midnight (start > end). Layered on top of
   * the pause gate — it suppresses sends inside the window without pausing anything.
   */
  quietHoursStart: string | null
  quietHoursEnd: string | null
}

export const DIGEST_DEFAULTS: DigestConfig = {
  morningEnabled: true,
  eveningEnabled: true,
  morningTime: "08:30",
  eveningTime: "18:30",
  maxCatchupMinutes: 120,
  quietHoursStart: null,
  quietHoursEnd: null,
}

/**
 * Overlay a user's stored preferences onto the digest defaults. Per-field
 * fallback keeps the dispatcher working for a user with no preferences row.
 * maxCatchupMinutes stays a system constant (not user-configurable).
 */
export function resolveDigestConfig(preferences: UserPreferences | null): DigestConfig {
  if (!preferences) {
    return DIGEST_DEFAULTS
  }
  return {
    morningEnabled: preferences.morningDigestEnabled ?? DIGEST_DEFAULTS.morningEnabled,
    eveningEnabled: preferences.eveningDigestEnabled ?? DIGEST_DEFAULTS.eveningEnabled,
    morningTime: preferences.morningDigestTime ?? DIGEST_DEFAULTS.morningTime,
    eveningTime: preferences.eveningDigestTime ?? DIGEST_DEFAULTS.eveningTime,
    maxCatchupMinutes: DIGEST_DEFAULTS.maxCatchupMinutes,
    quietHoursStart: preferences.quietHoursStart ?? DIGEST_DEFAULTS.quietHoursStart,
    quietHoursEnd: preferences.quietHoursEnd ?? DIGEST_DEFAULTS.quietHoursEnd,
  }
}
