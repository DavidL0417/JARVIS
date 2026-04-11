// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import type { SupabaseClient } from "@supabase/supabase-js"

export const DEMO_USER_EMAIL = "demo@jarvis.local"
export const DEMO_USER_NAME = "JARVIS Demo User"

interface DemoUserRecord {
  id: string
  email: string
  name: string
}

interface GetOrCreateDemoUserOptions {
  name?: string
}

export async function getOrCreateDemoUser(
  supabase: SupabaseClient,
  options: GetOrCreateDemoUserOptions = {},
) {
  const preferredName = options.name?.trim() || DEMO_USER_NAME

  // MVP note: keep the demo-user pattern explicit until real auth/user selection is wired.
  const { data, error } = await supabase
    .from("users")
    .upsert(
      {
        email: DEMO_USER_EMAIL,
        name: preferredName,
      },
      { onConflict: "email" },
    )
    .select("id, email, name")
    .single<DemoUserRecord>()

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create or fetch the MVP demo user.")
  }

  return data
}

// ##### END BACKEND #####
