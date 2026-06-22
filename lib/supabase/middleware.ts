import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

function hasSupabaseEnv() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
}

/**
 * Refresh the Supabase auth session on every navigation and write the rotated
 * sb-* cookies onto the outgoing response.
 *
 * Required by @supabase/ssr in the App Router: a Server Component / Route
 * Handler cannot write response cookies during render (lib/supabase/server.ts's
 * setAll() silently no-ops there), so without this middleware a freshly-minted
 * or refreshed session is never propagated server-side. The dashboard's
 * /api/dashboard + /api/calendars fetches then call auth.getUser(), see no user,
 * and 401 — surfacing the "JARVIS needs an authenticated user" sign-in shell
 * even right after a successful login.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  // Without Supabase env (e.g. an env-less preview deploy) degrade gracefully
  // instead of 500-ing every route — mirrors lib/supabase/client.ts.
  if (!hasSupabaseEnv()) {
    return supabaseResponse
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Do NOT run code between createServerClient and getUser(): getUser() is what
  // refreshes the auth token and writes the rotated cookies onto supabaseResponse.
  await supabase.auth.getUser()

  // Return supabaseResponse unchanged so the refreshed Set-Cookie headers reach
  // the browser. Building a new response without copying these cookies desyncs
  // server/browser and ends the session early.
  return supabaseResponse
}
