// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { NextResponse } from "next/server"

import { createSupabaseServerClient } from "@/lib/supabase/server"

function getSafeRedirectPath(candidate: string | null) {
  if (!candidate || !candidate.startsWith("/")) {
    return "/"
  }

  return candidate
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const next = getSafeRedirectPath(requestUrl.searchParams.get("next"))

  if (code) {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return NextResponse.redirect(new URL(next, requestUrl.origin))
    }
  }

  return NextResponse.redirect(new URL("/?authError=callback", requestUrl.origin))
}

// ##### END BACKEND #####
