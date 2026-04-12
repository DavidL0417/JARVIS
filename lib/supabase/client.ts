// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { createBrowserClient } from "@supabase/ssr"

function getRequiredPublicEnv(name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY") {
  // Next.js only exposes NEXT_PUBLIC env vars reliably in client bundles when accessed directly.
  const value =
    name === "NEXT_PUBLIC_SUPABASE_URL"
      ? process.env.NEXT_PUBLIC_SUPABASE_URL
      : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!value) {
    throw new Error(`Missing required Supabase environment variable: ${name}`)
  }

  return value
}

export function hasSupabasePublicEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    getRequiredPublicEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getRequiredPublicEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  )
}

export function tryCreateSupabaseBrowserClient() {
  if (!hasSupabasePublicEnv()) {
    return null
  }

  return createSupabaseBrowserClient()
}

// ##### END BACKEND #####
