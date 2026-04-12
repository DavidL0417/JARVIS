// ##### BACKEND API #####
// DO NOT MODIFY UNLESS BACKEND OWNER

import { NextResponse } from "next/server"

import { createSupabaseServerClient } from "@/lib/supabase/server"

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signOut()

  if (error) {
    return NextResponse.json(
      {
        error: "Failed to sign out.",
        details: error.message,
      },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true })
}

// ##### END BACKEND #####
