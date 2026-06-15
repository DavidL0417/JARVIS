import { NextResponse } from "next/server"

import { requireImessageOperator } from "@/lib/imessage/operator-auth"
import { requireImessageOperatorSession } from "@/lib/imessage/operator-session"
import { getImessageSuggestions, replaceImessageSuggestions } from "@/lib/imessage/store"
import { imessageSuggestionsRequestSchema } from "@/schemas/imessage"

export const runtime = "nodejs"

const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 })

// GET (operator session): the console reads suggested contacts — recent 1:1s the
// operator hasn't allowlisted yet. The RPC already excludes allowlisted handles.
export async function GET() {
  const auth = await requireImessageOperatorSession()
  if (!auth.ok) {
    return notFound()
  }
  const suggestions = await getImessageSuggestions(auth.userId, auth.adminClient)
  return NextResponse.json({ suggestions })
}

// POST (reader bearer): replace-all upload of the freshly computed suggestion set.
export async function POST(request: Request) {
  const auth = requireImessageOperator(request)
  if (!auth.ok) {
    return notFound()
  }

  const parsed = imessageSuggestionsRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request.", issues: parsed.error.flatten() }, { status: 400 })
  }

  const count = await replaceImessageSuggestions(auth.userId, parsed.data.suggestions, auth.adminClient)
  return NextResponse.json({ success: true, count })
}
