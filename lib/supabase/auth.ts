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

export class AuthBackendDependencyError extends Error {
  code: "backend_timeout" | "backend_error"

  constructor(message: string, code: "backend_timeout" | "backend_error" = "backend_error") {
    super(message)
    this.name = "AuthBackendDependencyError"
    this.code = code
  }
}

export function isAuthenticationRequiredError(error: unknown): error is AuthenticationRequiredError {
  return error instanceof AuthenticationRequiredError
}

export function isAuthBackendDependencyError(error: unknown): error is AuthBackendDependencyError {
  return error instanceof AuthBackendDependencyError
}

function errorField(error: unknown, key: "code" | "message" | "name" | "status" | "cause"): unknown {
  return error && typeof error === "object" && key in error
    ? (error as Record<string, unknown>)[key]
    : null
}

function isTransientAuthFetchError(error: unknown): boolean {
  const code = String(errorField(error, "code") || "")
  const message = String(errorField(error, "message") || "").toLowerCase()
  const name = String(errorField(error, "name") || "")
  const cause = errorField(error, "cause")

  if (
    code.includes("TIMEOUT") ||
    code.includes("ECONNRESET") ||
    code.includes("ENOTFOUND") ||
    code.includes("UND_ERR") ||
    name.includes("Timeout") ||
    message.includes("fetch failed") ||
    message.includes("connect timeout") ||
    message.includes("network")
  ) {
    return true
  }

  return Boolean(cause && isTransientAuthFetchError(cause))
}

function isDefinitiveAuthFailure(error: unknown): boolean {
  const status = errorField(error, "status")
  const message = String(errorField(error, "message") || "").toLowerCase()
  const name = String(errorField(error, "name") || "").toLowerCase()

  return status === 401 ||
    status === 403 ||
    name.includes("authsessionmissing") ||
    message.includes("auth session missing") ||
    message.includes("missing auth session")
}

export function classifySupabaseAuthError(error: unknown): "auth_required" | "backend_timeout" | "backend_error" {
  if (isTransientAuthFetchError(error)) return "backend_timeout"
  if (isDefinitiveAuthFailure(error)) return "auth_required"
  return "backend_error"
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

  const authErrorKind = error ? classifySupabaseAuthError(error) : null

  if (authErrorKind === "backend_timeout") {
    throw new AuthBackendDependencyError("Supabase auth request timed out before JARVIS could confirm the session.", "backend_timeout")
  }

  if (error && authErrorKind === "backend_error") {
    throw new AuthBackendDependencyError(error.message || "Supabase auth request failed.", "backend_error")
  }

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
