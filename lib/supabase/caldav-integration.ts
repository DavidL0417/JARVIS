import { getCalDavServerDisplayName } from "@/lib/caldav/constants"
import { USER_INTEGRATION_SELECT } from "@/lib/data/mappers"
import { getStoredIntegrationToken, upsertIntegrationToken } from "@/lib/supabase/integration-tokens"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import type { UserIntegrationRow, UserIntegrationStatus } from "@/types"

export interface StoredCalDavIntegration {
  provider_account_email: string | null
  provider_user_id: string | null
  status: UserIntegrationStatus
  server_url: string | null
  server_name: string | null
  last_synced_at: string | null
  password: string | null
}

export async function getStoredCalDavIntegration(userId: string): Promise<StoredCalDavIntegration | null> {
  const adminClient = createSupabaseAdminClient()
  const [integrationResult, tokenRow] = await Promise.all([
    adminClient
      .from("integrations")
      .select(`${USER_INTEGRATION_SELECT}, selected_source_id, selected_source_name`)
      .eq("user_id", userId)
      .eq("provider", "caldav")
      .maybeSingle<UserIntegrationRow>(),
    getStoredIntegrationToken(userId, "caldav"),
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
    server_url: integrationResult.data.selected_source_id ?? null,
    server_name:
      getCalDavServerDisplayName(integrationResult.data.selected_source_id) ??
      integrationResult.data.selected_source_name ??
      null,
    last_synced_at: integrationResult.data.last_synced_at,
    password: tokenRow?.access_token ?? null,
  }
}

export async function upsertCalDavIntegration(input: {
  userId: string
  serverUrl: string
  username: string
  password: string
}) {
  const adminClient = createSupabaseAdminClient()
  const normalizedUrl = new URL(input.serverUrl).toString()
  const serverName = getCalDavServerDisplayName(normalizedUrl)
  const { error } = await adminClient
    .from("integrations")
    .upsert(
      {
        user_id: input.userId,
        provider: "caldav",
        provider_account_email: input.username,
        provider_user_id: input.username,
        status: "connected",
        selected_calendar_id: null,
        selected_source_id: normalizedUrl,
        selected_source_name: serverName,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" },
    )

  if (error) {
    throw new Error(error.message)
  }

  await upsertIntegrationToken({
    userId: input.userId,
    provider: "caldav",
    accessToken: input.password,
    refreshToken: null,
    expiresAt: null,
    scope: "caldav:basic",
  })
}

export async function markCalDavIntegrationStatus(input: {
  userId: string
  status: UserIntegrationStatus
  summary?: string
}) {
  const adminClient = createSupabaseAdminClient()
  const { error } = await adminClient
    .from("integrations")
    .update({
      status: input.status,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", input.userId)
    .eq("provider", "caldav")

  if (error) {
    throw new Error(error.message)
  }

  if (input.summary) {
    await adminClient.from("source_snapshots").insert({
      user_id: input.userId,
      source: "caldav",
      freshness: "failed",
      summary: input.summary,
      payload: {},
    })
  }
}

export async function updateCalDavLastSyncedAt(userId: string) {
  const adminClient = createSupabaseAdminClient()
  const { error } = await adminClient
    .from("integrations")
    .update({
      status: "connected",
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("provider", "caldav")

  if (error) {
    throw new Error(error.message)
  }
}
