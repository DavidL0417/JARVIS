import { NextResponse } from "next/server"

import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"

const NOTION_AUTHORIZE_URL = "https://api.notion.com/v1/oauth/authorize"

function getRequiredEnv(name: "NOTION_CLIENT_ID") {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing required Notion environment variable: ${name}`)
  }

  return value
}

export async function POST(request: Request) {
  try {
    const { user } = await requireAuthenticatedUser()
    const body = await request.json().catch(() => ({})) as { next?: string }
    const origin = new URL(request.url).origin
    const redirectUri = `${origin}/api/integrations/notion/callback`
    const nonce = crypto.randomUUID()
    const state = Buffer.from(
      JSON.stringify({
        nonce,
        userId: user.id,
        next: body.next || "/dashboard",
      }),
    ).toString("base64url")
    const url = new URL(NOTION_AUTHORIZE_URL)

    url.searchParams.set("client_id", getRequiredEnv("NOTION_CLIENT_ID"))
    url.searchParams.set("response_type", "code")
    url.searchParams.set("owner", "user")
    url.searchParams.set("redirect_uri", redirectUri)
    url.searchParams.set("state", state)

    const response = NextResponse.json({
      success: true,
      authorizationUrl: url.toString(),
    })

    response.cookies.set("jarvis_notion_oauth_nonce", nonce, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    })

    return response
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to start Notion authorization.",
        details: error instanceof Error ? error.message : "Unknown Notion authorization error.",
      },
      { status: 500 },
    )
  }
}
