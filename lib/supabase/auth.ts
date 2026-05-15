import type { User as SupabaseAuthUser } from "@supabase/supabase-js"

import { ensureDefaultSecretaryMemoryForUser } from "@/lib/assistant/default-memory"
import { mapUserRowToUserProfile, USER_PROFILE_SELECT } from "@/lib/data/mappers"
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server"
import { ensureTaskCalendarForUser } from "@/lib/tasks-calendar"
import type { UserProfile, UserRow } from "@/types"

const FALLBACK_PROFILE_NAME = "JARVIS User"

export class AuthenticationRequiredError extends Error {
  constructor(message = "Authentication required.") {
    super(message)
    this.name = "AuthenticationRequiredError"
  }
}

export function isAuthenticationRequiredError(error: unknown): error is AuthenticationRequiredError {
  return error instanceof AuthenticationRequiredError
}

function normalizeNullableText(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function getPreferredName(authUser: SupabaseAuthUser, overrideName?: string | null) {
  return (
    normalizeNullableText(overrideName) ||
    normalizeNullableText(authUser.user_metadata?.full_name) ||
    normalizeNullableText(authUser.user_metadata?.name) ||
    normalizeNullableText(authUser.user_metadata?.user_name) ||
    normalizeNullableText(authUser.email?.split("@")[0]) ||
    FALLBACK_PROFILE_NAME
  )
}

function getAvatarUrl(authUser: SupabaseAuthUser, overrideAvatarUrl?: string | null) {
  return (
    normalizeNullableText(overrideAvatarUrl) ||
    normalizeNullableText(authUser.user_metadata?.avatar_url) ||
    normalizeNullableText(authUser.user_metadata?.picture)
  )
}

interface UserProfileOverrides {
  name?: string | null
  avatarUrl?: string | null
}

export async function getOrCreateUserProfile(
  authUser: SupabaseAuthUser,
  overrides: UserProfileOverrides = {},
): Promise<UserProfile> {
  const email = normalizeNullableText(authUser.email)

  if (!email) {
    throw new Error("Authenticated user is missing an email address.")
  }

  const adminClient = createSupabaseAdminClient()
  const { data, error } = await adminClient
    .from("profiles")
    .upsert(
      {
        id: authUser.id,
        email,
        name: getPreferredName(authUser, overrides.name),
        avatar_url: getAvatarUrl(authUser, overrides.avatarUrl),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    )
    .select(USER_PROFILE_SELECT)
    .single<UserRow>()

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create or fetch the authenticated user profile.")
  }

  const profile = mapUserRowToUserProfile(data)
  await ensureTaskCalendarForUser(profile.id)
  await ensureDefaultSecretaryMemoryForUser(adminClient, profile.id)
  return profile
}

export async function requireAuthenticatedUser(
  options: {
    profileOverrides?: UserProfileOverrides
  } = {},
) {
  const serverClient = await createSupabaseServerClient()
  const {
    data: { user: authUser },
    error,
  } = await serverClient.auth.getUser()

  if (error || !authUser) {
    throw new AuthenticationRequiredError()
  }

  const user = await getOrCreateUserProfile(authUser, options.profileOverrides)

  return {
    authUser,
    user,
    serverClient,
    adminClient: createSupabaseAdminClient(),
  }
}
