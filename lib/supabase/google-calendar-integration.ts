import type { Session, User } from "@supabase/supabase-js"

import { USER_INTEGRATION_SELECT } from "@/lib/data/mappers"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import type {
  IntegrationTokenRow,
  UserIntegrationRow,
  UserIntegrationStatus,
  UserIntegrationUpsertRow,
} from "@/types"

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

export interface StoredGoogleIntegration {
  provider_account_email: string | null
  provider_user_id: string | null
  status: UserIntegrationStatus
  selected_calendar_id: string | null
  selected_source_id: string | null
  selected_source_name: string | null
  last_synced_at: string | null
  access_token: string | null
  refresh_token: string | null
  expires_at: string | null
  scope: string | null
  token_updated_at: string | null
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

async function getGoogleTokenScope(accessToken: string) {
  const url = new URL("https://www.googleapis.com/oauth2/v1/tokeninfo")
  url.searchParams.set("access_token", accessToken)

  const response = await fetch(url, { cache: "no-store" })
  const payload = (await response.json().catch(() => null)) as { scope?: string; error?: string } | null

  if (!response.ok || !payload?.scope) {
    return null
  }

  return payload.scope
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

async function getStoredGoogleTokenRow(userId: string) {
  const adminClient = createSupabaseAdminClient()
  const { data, error } = await adminClient.rpc("get_google_integration_token", {
    token_user_id: userId,
  })

  if (error) {
    throw new Error(error.message)
  }

  if (!Array.isArray(data) || data.length === 0) {
    return null
  }

  return data[0] as IntegrationTokenRow
}

async function upsertGoogleTokenRow(input: {
  userId: string
  accessToken: string | null
  refreshToken: string | null
  expiresAt: string | null
  scope: string | null
}) {
  const adminClient = createSupabaseAdminClient()
  const { error } = await adminClient.rpc("upsert_google_integration_token", {
    token_user_id: input.userId,
    token_access_token: input.accessToken,
    token_refresh_token: input.refreshToken,
    token_expires_at: input.expiresAt,
    token_scope: input.scope,
  })

  if (error) {
    throw new Error(error.message)
  }
}

export async function getStoredGoogleIntegration(userId: string): Promise<StoredGoogleIntegration | null> {
  const adminClient = createSupabaseAdminClient()
  const [integrationResult, tokenRow] = await Promise.all([
    adminClient
      .from("integrations")
      .select(USER_INTEGRATION_SELECT)
      .eq("user_id", userId)
      .eq("provider", "google")
      .maybeSingle<UserIntegrationRow>(),
    getStoredGoogleTokenRow(userId),
  ])

  if (integrationResult.error) {
    throw new Error(integrationResult.error.message)
  }

  if (!integrationResult.data) {
    return null
  }

  return {
    provider_account_email: integrationResult.data.provider_account_email,
    provider_user_id: integrationResult.data.provider_user_id,
    status: integrationResult.data.status,
    selected_calendar_id: integrationResult.data.selected_calendar_id,
    selected_source_id: integrationResult.data.selected_source_id ?? null,
    selected_source_name: integrationResult.data.selected_source_name ?? null,
    last_synced_at: integrationResult.data.last_synced_at,
    access_token: tokenRow?.access_token ?? null,
    refresh_token: tokenRow?.refresh_token ?? null,
    expires_at: tokenRow?.expires_at ?? null,
    scope: tokenRow?.scope ?? null,
    token_updated_at: tokenRow?.updated_at ?? null,
  }
}

export async function upsertGoogleCalendarIntegration(input: UpsertGoogleIntegrationInput) {
  const adminClient = createSupabaseAdminClient()
  const existing = await getStoredGoogleIntegration(input.userId)
  const status = resolveIntegrationStatus(existing?.status ?? null, input, input.status)
  const verifiedScope = input.accessToken ? await getGoogleTokenScope(input.accessToken) : null

  const publicRow: UserIntegrationUpsertRow = {
    user_id: input.userId,
    provider: "google",
    provider_account_email: input.authUser.email ?? existing?.provider_account_email ?? null,
    provider_user_id: getGoogleProviderUserId(input.authUser) ?? existing?.provider_user_id ?? null,
    status,
    selected_calendar_id: existing?.selected_calendar_id ?? null,
    last_synced_at: existing?.last_synced_at ?? null,
  }

  const { error: integrationError } = await adminClient
    .from("integrations")
    .upsert(publicRow, { onConflict: "user_id,provider" })

  if (integrationError) {
    throw new Error(integrationError.message)
  }

  const tokenRow = {
    user_id: input.userId,
    provider: "google" as const,
    access_token: input.accessToken ?? existing?.access_token ?? null,
    refresh_token: input.refreshToken ?? existing?.refresh_token ?? null,
    expires_at: input.expiresAt ?? existing?.expires_at ?? null,
    scope: verifiedScope ?? input.scope ?? existing?.scope ?? null,
  }

  await upsertGoogleTokenRow({
    userId: tokenRow.user_id,
    accessToken: tokenRow.access_token,
    refreshToken: tokenRow.refresh_token,
    expiresAt: tokenRow.expires_at,
    scope: tokenRow.scope,
  })
}

export async function markGoogleIntegrationStatus(userId: string, status: UserIntegrationStatus, summary?: string) {
  const adminClient = createSupabaseAdminClient()
  const { error } = await adminClient
    .from("integrations")
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("provider", "google")

  if (error) {
    throw new Error(error.message)
  }

  if (summary) {
    await adminClient.from("source_snapshots").insert({
      user_id: userId,
      source: "google_calendar",
      freshness: "failed",
      summary,
      payload: {},
    })
  }
}

export async function updateGoogleLastSyncedAt(userId: string) {
  const adminClient = createSupabaseAdminClient()
  const { error } = await adminClient
    .from("integrations")
    .update({
      status: "connected",
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("provider", "google")

  if (error) {
    throw new Error(error.message)
  }
}

export async function refreshGoogleAccessToken(userId: string, refreshToken: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    await markGoogleIntegrationStatus(userId, "needs_reauth", "Google token refresh failed because OAuth client env vars are missing.")
    return null
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
    cache: "no-store",
  })
  const payload = (await response.json().catch(() => null)) as {
    access_token?: string
    expires_in?: number
    scope?: string
    error?: string
    error_description?: string
  } | null

  if (!response.ok) {
    const permanentAuthFailure = response.status === 400 || response.status === 401
    const detail = payload?.error_description || payload?.error || `status ${response.status}`

    if (permanentAuthFailure) {
      await upsertGoogleTokenRow({
        userId,
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
        scope: null,
      })
    }

    await markGoogleIntegrationStatus(
      userId,
      permanentAuthFailure ? "needs_reauth" : "error",
      permanentAuthFailure
        ? `Google token refresh was rejected (${detail}). Reconnect Google to grant Calendar and Gmail access again.`
        : `Google token refresh failed with ${detail}.`,
    )
    return null
  }

  if (!payload?.access_token) {
    await markGoogleIntegrationStatus(userId, "needs_reauth", "Google token refresh returned no access token.")
    return null
  }

  const expiresAt =
    typeof payload.expires_in === "number"
      ? new Date(Date.now() + payload.expires_in * 1_000).toISOString()
      : null

  await upsertGoogleTokenRow({
    userId,
    accessToken: payload.access_token,
    refreshToken,
    expiresAt,
    scope: payload.scope ?? null,
  })

  return payload.access_token
}

export async function getValidGoogleAccessToken(userId: string) {
  const integration = await getStoredGoogleIntegration(userId)

  if (!integration || integration.status === "disconnected") {
    return null
  }

  if (integration.access_token) {
    const expiresAt = integration.expires_at ? new Date(integration.expires_at).getTime() : null

    if (!expiresAt || expiresAt > Date.now() + 60_000) {
      return integration.access_token
    }
  }

  if (!integration.refresh_token) {
    await markGoogleIntegrationStatus(userId, "needs_reauth", "Google Calendar needs reauthorization because no refresh token is stored.")
    return null
  }

  return refreshGoogleAccessToken(userId, integration.refresh_token)
}
