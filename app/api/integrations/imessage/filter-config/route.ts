import { NextResponse } from "next/server"

import { requireImessageOperator } from "@/lib/imessage/operator-auth"
import { getImessageAllowlist } from "@/lib/imessage/store"

export const runtime = "nodejs"

// The local reader fetches this at the start of each run to learn who is allowlisted,
// then does all filtering ON THE MAC before POSTing — so spam/2FA/non-allowlisted
// group bodies never leave the machine. Bearer-authed with IMESSAGE_INGEST_SECRET, the
// same secret the reader already sends to /ingest; 404s when the feature is off.
export async function GET(request: Request) {
  const auth = requireImessageOperator(request)
  if (!auth.ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 })
  }

  const contacts = await getImessageAllowlist(auth.userId, auth.adminClient)
  return NextResponse.json({
    allowlist: contacts.map((contact) => ({
      handleNorm: contact.handleNorm,
      displayName: contact.displayName,
    })),
  })
}
