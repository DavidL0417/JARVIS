import { createSupabaseAdminClient } from "@/lib/supabase/server"
import type { SourceConnectorId } from "@/types"

export interface ConnectorSetting {
  connectorId: SourceConnectorId
  enabled: boolean
}

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

const DEFAULT_ENABLED = true

export async function getConnectorSettingsForUser(
  userId: string,
  adminClient: AdminClient = createSupabaseAdminClient(),
) {
  const { data, error } = await adminClient
    .from("connector_settings")
    .select("connector_id, enabled")
    .eq("user_id", userId)

  if (error) {
    throw new Error(error.message)
  }

  return new Map<SourceConnectorId, boolean>(
    (data ?? []).map((row) => [
      row.connector_id as SourceConnectorId,
      typeof row.enabled === "boolean" ? row.enabled : DEFAULT_ENABLED,
    ]),
  )
}

export function isConnectorEnabled(
  settings: Map<SourceConnectorId, boolean>,
  connectorId: SourceConnectorId,
) {
  return settings.get(connectorId) ?? DEFAULT_ENABLED
}

export async function upsertConnectorEnabled(input: {
  userId: string
  connectorId: SourceConnectorId
  enabled: boolean
  adminClient?: AdminClient
}) {
  const adminClient = input.adminClient ?? createSupabaseAdminClient()
  const { error } = await adminClient
    .from("connector_settings")
    .upsert(
      {
        user_id: input.userId,
        connector_id: input.connectorId,
        enabled: input.enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,connector_id" },
    )

  if (error) {
    throw new Error(error.message)
  }
}
