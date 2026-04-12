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

async function getOrCreateDemoAuthUser(supabase: SupabaseClient, preferredName: string) {
  const authAdmin = (supabase.auth as { admin?: unknown }).admin as
    | {
        listUsers: (params?: { page?: number; perPage?: number }) => Promise<{
          data?: { users?: Array<{ id: string; email?: string | null }> }
          error?: { message: string } | null
        }>
        createUser: (attributes: {
          email: string
          email_confirm?: boolean
          user_metadata?: Record<string, unknown>
        }) => Promise<{
          data?: { user?: { id: string; email?: string | null } | null }
          error?: { message: string } | null
        }>
      }
    | undefined

  if (!authAdmin) {
    throw new Error("Supabase auth admin client is unavailable for demo-user bootstrap.")
  }

  const listResult = await authAdmin.listUsers({ page: 1, perPage: 200 })

  if (listResult.error) {
    throw new Error(listResult.error.message)
  }

  const existingAuthUser = (listResult.data?.users || []).find(
    (user) => user.email?.toLowerCase() === DEMO_USER_EMAIL.toLowerCase(),
  )

  if (existingAuthUser) {
    return existingAuthUser
  }

  const createResult = await authAdmin.createUser({
    email: DEMO_USER_EMAIL,
    email_confirm: true,
    user_metadata: {
      name: preferredName,
    },
  })

  if (createResult.error || !createResult.data?.user) {
    throw new Error(createResult.error?.message ?? "Failed to create the demo auth user.")
  }

  return createResult.data.user
}

export async function getOrCreateDemoUser(
  supabase: SupabaseClient,
  options: GetOrCreateDemoUserOptions = {},
) {
  const preferredName = options.name?.trim() || DEMO_USER_NAME

  // MVP note: keep the demo-user pattern explicit until real auth/user selection is wired.
  const existingUserResult = await supabase
    .from("users")
    .select("id, email, name")
    .eq("email", DEMO_USER_EMAIL)
    .maybeSingle<DemoUserRecord>()

  if (existingUserResult.error) {
    throw new Error(existingUserResult.error.message)
  }

  if (existingUserResult.data) {
    if (existingUserResult.data.name !== preferredName) {
      const updateResult = await supabase
        .from("users")
        .update({ name: preferredName })
        .eq("id", existingUserResult.data.id)
        .select("id, email, name")
        .single<DemoUserRecord>()

      if (updateResult.error || !updateResult.data) {
        throw new Error(updateResult.error?.message ?? "Failed to update the MVP demo user.")
      }

      return updateResult.data
    }

    return existingUserResult.data
  }

  const authUser = await getOrCreateDemoAuthUser(supabase, preferredName)

  const { data, error } = await supabase
    .from("users")
    .insert({
      id: authUser.id,
      email: DEMO_USER_EMAIL,
      name: preferredName,
    })
    .select("id, email, name")
    .single<DemoUserRecord>()

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create or fetch the MVP demo user.")
  }

  return data
}

// ##### END BACKEND #####
