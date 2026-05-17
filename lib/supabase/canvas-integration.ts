import { USER_INTEGRATION_SELECT } from "@/lib/data/mappers"
import { getStoredIntegrationToken, upsertIntegrationToken } from "@/lib/supabase/integration-tokens"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import type { UserIntegrationRow, UserIntegrationStatus } from "@/types"

export interface StoredCanvasIntegration {
  provider_account_email: string | null
  provider_user_id: string | null
  status: UserIntegrationStatus
  base_url: string | null
  base_name: string | null
  last_synced_at: string | null
  access_token: string | null
}

export async function getStoredCanvasIntegration(userId: string): Promise<StoredCanvasIntegration | null> {
  const adminClient = createSupabaseAdminClient()
  const [integrationResult, tokenRow] = await Promise.all([
    adminClient
      .from("integrations")
      .select(`${USER_INTEGRATION_SELECT}, selected_source_id, selected_source_name`)
      .eq("user_id", userId)
      .eq("provider", "canvas")
      .maybeSingle<UserIntegrationRow>(),
    getStoredIntegrationToken(userId, "canvas"),
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
    base_url: integrationResult.data.selected_source_id ?? null,
    base_name: integrationResult.data.selected_source_name ?? null,
    last_synced_at: integrationResult.data.last_synced_at,
    access_token: tokenRow?.access_token ?? null,
  }
}

export async function upsertCanvasIntegration(input: {
  userId: string
  baseUrl: string
  accessToken: string
  accountLabel: string | null
  providerUserId: string | null
  providerAccountEmail: string | null
}) {
  const adminClient = createSupabaseAdminClient()
  const baseName = new URL(input.baseUrl).host
  const { error } = await adminClient
    .from("integrations")
    .upsert(
      {
        user_id: input.userId,
        provider: "canvas",
        provider_account_email: input.providerAccountEmail ?? input.accountLabel,
        provider_user_id: input.providerUserId,
        status: "connected",
        selected_calendar_id: null,
        selected_source_id: input.baseUrl,
        selected_source_name: baseName,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" },
    )

  if (error) {
    throw new Error(error.message)
  }

  await upsertIntegrationToken({
    userId: input.userId,
    provider: "canvas",
    accessToken: input.accessToken,
    refreshToken: null,
    expiresAt: null,
    scope: null,
  })
}

export async function markCanvasIntegrationStatus(input: {
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
    .eq("provider", "canvas")

  if (error) {
    throw new Error(error.message)
  }

  if (input.summary) {
    await adminClient.from("source_snapshots").insert({
      user_id: input.userId,
      source: "canvas",
      freshness: "failed",
      summary: input.summary,
      payload: {},
    })
  }
}
