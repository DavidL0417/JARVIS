import { NextResponse } from "next/server"
import { z } from "zod"

import { normalizeHandle } from "@/lib/imessage/handles"
import { requireImessageOperatorSession } from "@/lib/imessage/operator-session"
import { addImessageContact, getImessageAllowlist, removeImessageContact } from "@/lib/imessage/store"

export const runtime = "nodejs"

// Operator-only management of the iMessage contact allowlist (the curated people the
// local reader is allowed to forward). Every method 404s for anyone who isn't the
// operator, so the feature is invisible to other accounts. Mutations return the full
// current list so the UI can just replace its state.

const addContactSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  handle: z.string().trim().min(1).max(300),
})

const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 })

export async function GET() {
  const auth = await requireImessageOperatorSession()
  if (!auth.ok) {
    return notFound()
  }
  const contacts = await getImessageAllowlist(auth.userId, auth.adminClient)
  return NextResponse.json({ contacts })
}

export async function POST(request: Request) {
  const auth = await requireImessageOperatorSession()
  if (!auth.ok) {
    return notFound()
  }

  const parsed = addContactSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid contact.", issues: parsed.error.flatten() }, { status: 400 })
  }
  if (!normalizeHandle(parsed.data.handle)) {
    return NextResponse.json({ error: "Handle must be a phone number or email." }, { status: 400 })
  }

  await addImessageContact({
    userId: auth.userId,
    displayName: parsed.data.displayName,
    handle: parsed.data.handle,
    adminClient: auth.adminClient,
  })
  const contacts = await getImessageAllowlist(auth.userId, auth.adminClient)
  return NextResponse.json({ contacts })
}

export async function DELETE(request: Request) {
  const auth = await requireImessageOperatorSession()
  if (!auth.ok) {
    return notFound()
  }

  const contactId = new URL(request.url).searchParams.get("id")?.trim()
  if (!contactId) {
    return NextResponse.json({ error: "Missing contact id." }, { status: 400 })
  }

  await removeImessageContact({ userId: auth.userId, contactId, adminClient: auth.adminClient })
  const contacts = await getImessageAllowlist(auth.userId, auth.adminClient)
  return NextResponse.json({ contacts })
}
