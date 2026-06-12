import { createSupabaseAdminClient } from "@/lib/supabase/server"

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

export interface AutomationSettings {
  paused: boolean
  pausedUntil: string | null
  pausedReason: string | null
}

const DEFAULT_SETTINGS: AutomationSettings = {
  paused: false,
  pausedUntil: null,
  pausedReason: null,
}

export async function getAutomationSettings(
  userId: string,
  adminClient: AdminClient = createSupabaseAdminClient(),
): Promise<AutomationSettings> {
  const { data, error } = await adminClient
    .from("automation_settings")
    .select("paused, paused_until, paused_reason")
    .eq("user_id", userId)
    .maybeSingle<{ paused: boolean; paused_until: string | null; paused_reason: string | null }>()

  if (error) {
    throw new Error(error.message)
  }

  if (!data) {
    return DEFAULT_SETTINGS
  }

  return {
    paused: Boolean(data.paused),
    pausedUntil: data.paused_until,
    pausedReason: data.paused_reason,
  }
}

/**
 * Pause is in effect only when the flag is set AND any `paused_until` has not
 * elapsed. Expiry is computed at read time, so no cron is needed to clear it.
 */
export function isAutomationPaused(settings: AutomationSettings, now: Date = new Date()): boolean {
  if (!settings.paused) {
    return false
  }

  if (settings.pausedUntil) {
    const until = new Date(settings.pausedUntil).getTime()
    if (Number.isFinite(until) && until <= now.getTime()) {
      return false
    }
  }

  return true
}

export async function setAutomationPaused(input: {
  userId: string
  paused: boolean
  pausedUntil?: string | null
  pausedReason?: string | null
  adminClient?: AdminClient
}): Promise<AutomationSettings> {
  const adminClient = input.adminClient ?? createSupabaseAdminClient()
  const pausedUntil = input.paused ? input.pausedUntil ?? null : null
  const pausedReason = input.paused ? input.pausedReason ?? null : null

  const { data, error } = await adminClient
    .from("automation_settings")
    .upsert(
      {
        user_id: input.userId,
        paused: input.paused,
        paused_until: pausedUntil,
        paused_reason: pausedReason,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select("paused, paused_until, paused_reason")
    .maybeSingle<{ paused: boolean; paused_until: string | null; paused_reason: string | null }>()

  if (error) {
    throw new Error(error.message)
  }

  return {
    paused: Boolean(data?.paused),
    pausedUntil: data?.paused_until ?? null,
    pausedReason: data?.paused_reason ?? null,
  }
}
