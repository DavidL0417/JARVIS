import { NextRequest, NextResponse } from "next/server"

import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import { upsertIntegrationToken } from "@/lib/supabase/integration-tokens"

interface NotionOAuthState {
  nonce?: string
  userId?: string
  next?: string
}

interface NotionTokenResponse {
  access_token?: string
  refresh_token?: string
  bot_id?: string
  workspace_id?: string
  workspace_name?: string
  duplicated_template_id?: string | null
  owner?: unknown
  error?: string
  error_description?: string
}

function getRequiredEnv(name: "NOTION_CLIENT_ID" | "NOTION_CLIENT_SECRET") {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing required Notion environment variable: ${name}`)
  }

  return value
}

function parseState(value: string | null): NotionOAuthState {
  if (!value) {
    return {}
  }

  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as NotionOAuthState
  } catch {
    return {}
  }
}

async function exchangeNotionCode(input: {
  code: string
  redirectUri: string
}) {
  const clientId = getRequiredEnv("NOTION_CLIENT_ID")
  const clientSecret = getRequiredEnv("NOTION_CLIENT_SECRET")
  const response = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
    cache: "no-store",
  })
  const payload = (await response.json().catch(() => null)) as NotionTokenResponse | null

  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_description || payload?.error || `Notion OAuth failed with status ${response.status}.`)
  }

  return payload
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = parseState(url.searchParams.get("state"))
  const redirectUri = `${url.origin}/api/integrations/notion/callback`

  try {
    if (!code) {
      throw new Error("Notion callback is missing an authorization code.")
    }

    const nonceCookie = request.cookies.get("jarvis_notion_oauth_nonce")?.value

    if (!state.nonce || !nonceCookie || state.nonce !== nonceCookie) {
      throw new Error("Notion OAuth state did not match this browser session.")
    }

    const { adminClient, user } = await requireAuthenticatedUser()

    if (state.userId && state.userId !== user.id) {
      throw new Error("Notion OAuth state belongs to a different authenticated user.")
    }

    const token = await exchangeNotionCode({ code, redirectUri })
    const { error: integrationError } = await adminClient
      .from("integrations")
      .upsert(
        {
          user_id: user.id,
          provider: "notion",
          provider_account_email: token.workspace_name ?? null,
          provider_user_id: token.workspace_id ?? token.bot_id ?? null,
          status: "connected",
          selected_calendar_id: null,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "user_id,provider" },
      )

    if (integrationError) {
      throw new Error(integrationError.message)
    }

    await upsertIntegrationToken({
      userId: user.id,
      provider: "notion",
      accessToken: token.access_token ?? null,
      refreshToken: token.refresh_token ?? null,
      expiresAt: null,
      scope: null,
    })

    await adminClient.from("source_snapshots").insert({
      user_id: user.id,
      source: "notion",
      source_ref: token.workspace_id ?? token.workspace_name ?? null,
      freshness: "fresh",
      summary: `Connected Notion${token.workspace_name ? ` workspace ${token.workspace_name}` : ""}.`,
      payload: {
        workspaceId: token.workspace_id ?? null,
        workspaceName: token.workspace_name ?? null,
        botId: token.bot_id ?? null,
      },
    })

    const response = NextResponse.redirect(new URL(state.next || "/dashboard", url.origin))
    response.cookies.delete("jarvis_notion_oauth_nonce")
    return response
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.redirect(new URL("/dashboard?error=auth-required", url.origin))
    }

    const nextUrl = new URL("/dashboard", url.origin)
    nextUrl.searchParams.set("error", error instanceof Error ? error.message : "Notion authorization failed.")
    return NextResponse.redirect(nextUrl)
  }
}
