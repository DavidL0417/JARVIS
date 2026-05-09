import { createSupabaseAdminClient } from "@/lib/supabase/server"
import type { IntegrationProvider, IntegrationTokenRow } from "@/types"

export async function getStoredIntegrationToken(userId: string, provider: IntegrationProvider) {
  const adminClient = createSupabaseAdminClient()
  const { data, error } = await adminClient.rpc("get_integration_token", {
    token_user_id: userId,
    token_provider: provider,
  })

  if (error) {
    throw new Error(error.message)
  }

  if (!Array.isArray(data) || data.length === 0) {
    return null
  }

  return data[0] as IntegrationTokenRow
}

export async function upsertIntegrationToken(input: {
  userId: string
  provider: IntegrationProvider
  accessToken: string | null
  refreshToken: string | null
  expiresAt: string | null
  scope: string | null
}) {
  const adminClient = createSupabaseAdminClient()
  const { error } = await adminClient.rpc("upsert_integration_token", {
    token_user_id: input.userId,
    token_provider: input.provider,
    token_access_token: input.accessToken,
    token_refresh_token: input.refreshToken,
    token_expires_at: input.expiresAt,
    token_scope: input.scope,
  })

  if (error) {
    throw new Error(error.message)
  }
}
