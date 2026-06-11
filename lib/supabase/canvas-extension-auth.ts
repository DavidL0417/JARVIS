import { getCanvasExtensionTokenRecord } from "@/lib/supabase/canvas-extension-tokens"
import { createSupabaseAdminClient } from "@/lib/supabase/server"

export function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization")
  const match = authorization?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

export async function requireCanvasExtensionToken(request: Request) {
  const token = bearerToken(request)

  if (!token) {
    return {
      error: "Canvas extension token required.",
      status: 401,
      adminClient: null,
      tokenRecord: null,
    } as const
  }

  const tokenRecord = await getCanvasExtensionTokenRecord(token)

  if (!tokenRecord) {
    return {
      error: "Canvas extension token is invalid or revoked.",
      status: 401,
      adminClient: null,
      tokenRecord: null,
    } as const
  }

  return {
    error: null,
    status: 200,
    adminClient: createSupabaseAdminClient(),
    tokenRecord,
  } as const
}
