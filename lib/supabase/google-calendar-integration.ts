// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import type { Session, User } from "@supabase/supabase-js"

import { createSupabaseAdminClient } from "@/lib/supabase/server"
import type { UserIntegrationRow, UserIntegrationStatus } from "@/types"

type SupabaseOAuthSession = Session & {
  provider_token?: string | null
  provider_refresh_token?: string | null
}

interface GoogleIntegrationTokens {
  accessToken?: string | null
  refreshToken?: string | null
  expiresAt?: string | null
  scope?: string | null
}

interface UpsertGoogleIntegrationInput extends GoogleIntegrationTokens {
  userId: string
  authUser: User
  status?: UserIntegrationStatus
}

interface ExistingGoogleIntegrationRow {
  provider_account_email: string | null
  provider_user_id: string | null
  access_token: string | null
  refresh_token: string | null
  expires_at: string | null
  scope: string | null
  status: UserIntegrationStatus
  selected_calendar_id: string | null
  last_synced_at: string | null
}

export function getGoogleTokensFromSession(session: Session | null): Required<GoogleIntegrationTokens> {
  const oauthSession = session as SupabaseOAuthSession | null

  return {
    accessToken: oauthSession?.provider_token ?? null,
    refreshToken: oauthSession?.provider_refresh_token ?? null,
    expiresAt: session?.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    scope: null,
  }
}

function getGoogleProviderUserId(authUser: User) {
  const googleIdentity = authUser.identities?.find((identity) => identity.provider === "google")

  return googleIdentity?.id ?? null
}

function resolveIntegrationStatus(
  existingStatus: UserIntegrationStatus | null,
  nextTokens: GoogleIntegrationTokens,
  requestedStatus?: UserIntegrationStatus,
): UserIntegrationStatus {
  if (requestedStatus) {
    return requestedStatus
  }

  if (nextTokens.accessToken || nextTokens.refreshToken) {
    return "connected"
  }

  return existingStatus ?? "needs_reauth"
}

export async function getStoredGoogleIntegration(userId: string) {
  const adminClient = createSupabaseAdminClient()
  const { data, error } = await adminClient
    .from("user_integrations")
    .select(
      "provider_account_email, provider_user_id, access_token, refresh_token, expires_at, scope, status, selected_calendar_id, last_synced_at",
    )
    .eq("user_id", userId)
    .eq("provider", "google")
    .maybeSingle<ExistingGoogleIntegrationRow>()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function upsertGoogleCalendarIntegration(input: UpsertGoogleIntegrationInput) {
  const adminClient = createSupabaseAdminClient()
  const existing = await getStoredGoogleIntegration(input.userId)

  const row: Omit<UserIntegrationRow, "id" | "created_at" | "updated_at"> = {
    user_id: input.userId,
    provider: "google",
    provider_account_email: input.authUser.email ?? existing?.provider_account_email ?? null,
    provider_user_id: getGoogleProviderUserId(input.authUser) ?? existing?.provider_user_id ?? null,
    access_token: input.accessToken ?? existing?.access_token ?? null,
    refresh_token: input.refreshToken ?? existing?.refresh_token ?? null,
    expires_at: input.expiresAt ?? existing?.expires_at ?? null,
    scope: input.scope ?? existing?.scope ?? null,
    status: resolveIntegrationStatus(existing?.status ?? null, input, input.status),
    selected_calendar_id: existing?.selected_calendar_id ?? null,
    last_synced_at: existing?.last_synced_at ?? null,
  }

  const { error } = await adminClient
    .from("user_integrations")
    .upsert(row, { onConflict: "user_id,provider" })

  if (error) {
    throw new Error(error.message)
  }
}

// ##### END BACKEND #####
