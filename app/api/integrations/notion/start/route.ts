import { NextResponse } from "next/server"

import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"

const NOTION_AUTHORIZE_URL = "https://api.notion.com/v1/oauth/authorize"
const NOTION_MISSING_CONFIG_MESSAGE =
  "This deployment has not configured the Notion connector yet. The app owner must add one Notion public OAuth connection before users can connect a workspace."

class NotionMissingConfigError extends Error {
  constructor() {
    super(NOTION_MISSING_CONFIG_MESSAGE)
    this.name = "NotionMissingConfigError"
  }
}

function getRequiredEnv(name: "NOTION_CLIENT_ID" | "NOTION_CLIENT_SECRET") {
  const value = process.env[name]

  if (!value) {
    throw new NotionMissingConfigError()
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
    getRequiredEnv("NOTION_CLIENT_SECRET")
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

    if (error instanceof NotionMissingConfigError) {
      console.error("Notion OAuth configuration is missing NOTION_CLIENT_ID or NOTION_CLIENT_SECRET.")
      return NextResponse.json(
        {
          error: NOTION_MISSING_CONFIG_MESSAGE,
          code: "NOTION_OAUTH_MISSING_CONFIG",
        },
        { status: 503 },
      )
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
