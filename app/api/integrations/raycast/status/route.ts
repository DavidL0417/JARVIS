import { NextResponse } from "next/server"

import { requireRaycastOperatorSession } from "@/lib/raycast/operator-session"

export const runtime = "nodejs"

const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 })

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

// GET (operator session only): the read-only Raycast status card reads the latest
// mirrored snapshot — when it last landed and the digest counts — so the operator can
// SEE the intake is alive without a connector card. There is no write side here: the
// only writer is the bearer-gated ingest route the local reader POSTs to. Non-operators
// (and any deployment without RAYCAST_OPERATOR_USER_ID) get one indistinguishable 404.
export async function GET() {
  const auth = await requireRaycastOperatorSession()
  if (!auth.ok) {
    return notFound()
  }

  const { data, error } = await auth.adminClient
    .from("source_snapshots")
    .select("captured_at, summary, payload")
    .eq("user_id", auth.userId)
    .eq("source", "raycast")
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ captured_at: string; summary: string | null; payload: Record<string, unknown> | null }>()

  if (error) {
    return NextResponse.json({ error: "Failed to read Raycast status." }, { status: 500 })
  }

  if (!data) {
    // Operator is configured, but no snapshot has ever landed (reader not run yet).
    return NextResponse.json({ lastCapturedAt: null })
  }

  const payload = data.payload ?? {}

  return NextResponse.json({
    lastCapturedAt: data.captured_at,
    summary: data.summary ?? "",
    noteCount: asCount(payload.noteCount),
    openTasks: asCount(payload.openTasks),
    doneTasks: asCount(payload.doneTasks),
    bullets: asCount(payload.bullets),
  })
}
