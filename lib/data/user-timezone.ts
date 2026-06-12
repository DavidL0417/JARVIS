import { createSupabaseAdminClient } from "@/lib/supabase/server"
import { DEFAULT_TIMEZONE } from "@/lib/time/zoned"

/**
 * Load the user's configured IANA timezone, falling back to the app default.
 * Used by calendar sync to place all-day events on the correct local day.
 */
export async function loadUserTimezone(userId: string): Promise<string> {
  const adminClient = createSupabaseAdminClient()
  const { data } = await adminClient
    .from("preferences")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle<{ timezone: string | null }>()

  const timezone = data?.timezone?.trim()
  return timezone && timezone.length > 0 ? timezone : DEFAULT_TIMEZONE
}
