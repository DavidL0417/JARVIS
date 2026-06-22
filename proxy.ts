import { type NextRequest } from "next/server"

import { updateSession } from "@/lib/supabase/middleware"

// Next 16's renamed middleware convention. This is the @supabase/ssr session
// refresh: it runs updateSession() on every matched request so the auth token
// is refreshed and the rotated sb-* cookies are propagated server-side. Without
// it, server-side auth.getUser() never sees a freshly-minted session and the
// dashboard 401s right after login. See lib/supabase/middleware.ts.
export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Run on every request EXCEPT static assets. Crucially this still covers
     * /api and /auth — those surfaces need the refreshed auth cookies, so do not
     * add them to the exclusion list (doing so re-breaks server-side session reads).
     * Excluded: _next static/image output, favicon, and common image files.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
