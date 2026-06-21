import { mapPreferencesRowToPreferences, PREFERENCES_SELECT } from "@/lib/data/mappers"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import type { UserPreferences, UserPreferencesRow } from "@/types"

/**
 * Read-only load of a user's full preferences row, mapped to the app shape.
 * Returns null when the user has no row yet (callers fall back to defaults) —
 * unlike the preferences API's getOrCreatePreferences, this never writes.
 */
export async function loadUserPreferences(
  userId: string,
  adminClient: ReturnType<typeof createSupabaseAdminClient> = createSupabaseAdminClient(),
): Promise<UserPreferences | null> {
  const { data } = await adminClient
    .from("preferences")
    .select(PREFERENCES_SELECT)
    .eq("user_id", userId)
    .maybeSingle<UserPreferencesRow>()

  return data ? mapPreferencesRowToPreferences(data) : null
}
