import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Outcome =
  | { ok: true; status: "added" | "already-on-list" }
  | { ok: false; status: "invalid" | "server-error"; message: string }

type WaitlistStorageError = {
  code?: string
  message?: string
}

function getStorageErrorMessage(error: WaitlistStorageError) {
  if (error.code === "42501") {
    return "Waitlist storage rejected the server key. Check SUPABASE_SERVICE_ROLE_KEY and table grants."
  }

  if (error.code === "42P01" || error.code === "PGRST205") {
    return "Waitlist storage is missing the waitlist table. Apply the Supabase migrations."
  }

  return `Waitlist storage failed: ${error.message || "Unknown Supabase error."}`
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    return null
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function POST(request: Request): Promise<NextResponse<Outcome>> {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { ok: false, status: "invalid", message: "Send a JSON body with an email." },
      { status: 400 },
    )
  }

  const rawEmail = body && typeof body === "object" && "email" in body ? (body as { email: unknown }).email : null
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : ""

  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json(
      { ok: false, status: "invalid", message: "That email doesn't look right." },
      { status: 400 },
    )
  }

  const supabase = getServiceClient()

  if (!supabase) {
    return NextResponse.json(
      { ok: false, status: "server-error", message: "Waitlist storage isn't configured yet." },
      { status: 503 },
    )
  }

  const userAgent = request.headers.get("user-agent")?.slice(0, 500) ?? null

  const { error } = await supabase.from("waitlist").insert({
    email,
    user_agent: userAgent,
    source: "landing",
  })

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ ok: true, status: "already-on-list" })
    }

    console.error("Waitlist insert failed", error)
    return NextResponse.json(
      { ok: false, status: "server-error", message: getStorageErrorMessage(error) },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, status: "added" })
}
