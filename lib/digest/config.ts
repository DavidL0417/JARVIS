// Phase 2 proactive-digest configuration.
//
// v1 ships on these hard-coded defaults (operator-only). Phase 3's settings UI
// will source per-user overrides from the `preferences` table (enable flags +
// send times); until then the dispatcher reads DIGEST_DEFAULTS.

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
}

export const DIGEST_DEFAULTS: DigestConfig = {
  morningEnabled: true,
  eveningEnabled: true,
  morningTime: "08:30",
  eveningTime: "18:30",
  maxCatchupMinutes: 120,
}
