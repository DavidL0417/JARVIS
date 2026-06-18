import { NextResponse } from "next/server"

import { mapRiskDecisionRowToRiskDecision, RISK_DECISION_SELECT } from "@/lib/data/mappers"
import { DEFAULT_SNOOZE_MS, RISK_TYPE_CONFIG } from "@/lib/risk-types"
import {
  isAuthenticationRequiredError,
  requireAuthenticatedUser,
} from "@/lib/supabase/auth"
import {
  createRiskDecisionRequestSchema,
  deleteRiskDecisionRequestSchema,
  deleteRiskDecisionResponseSchema,
  riskDecisionResponseSchema,
} from "@/schemas/risks"
import type { RiskDecisionRow } from "@/types"

// Persist the operator's decision about a derived risk: snooze (return later) or
// dismiss (park in the Archive). Risks themselves stay ephemeral — only the
// decision is stored, keyed by (user, risk type, subject). Re-deciding upserts.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = createRiskDecisionRequestSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid risk decision request", issues: parsed.error.flatten() },
      { status: 400 },
    )
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()
    const now = new Date()
    const nowIso = now.toISOString()
    // task_id is a real FK, so only persist it for task-scoped risks.
    const taskId = RISK_TYPE_CONFIG[parsed.data.riskType].taskScoped
      ? parsed.data.taskId ?? null
      : null
    const snoozeMs = parsed.data.snoozeMinutes ? parsed.data.snoozeMinutes * 60_000 : DEFAULT_SNOOZE_MS
    const dismissedUntil =
      parsed.data.action === "snooze" ? new Date(now.getTime() + snoozeMs).toISOString() : null
    const archivedAt = parsed.data.action === "dismiss" ? nowIso : null

    const { data, error } = await adminClient
      .from("risk_decisions")
      .upsert(
        {
          user_id: user.id,
          risk_type: parsed.data.riskType,
          subject_key: parsed.data.subjectKey,
          task_id: taskId,
          dismissed_until: dismissedUntil,
          archived_at: archivedAt,
          updated_at: nowIso,
        },
        { onConflict: "user_id,risk_type,subject_key" },
      )
      .select(RISK_DECISION_SELECT)
      .single<RiskDecisionRow>()

    if (error) {
      throw new Error(error.message)
    }

    const responsePayload = {
      success: true as const,
      decision: mapRiskDecisionRowToRiskDecision(data),
    }
    const parsedResponse = riskDecisionResponseSchema.safeParse(responsePayload)

    if (!parsedResponse.success) {
      return NextResponse.json(
        { error: "Invalid risk decision response payload", issues: parsedResponse.error.flatten() },
        { status: 500 },
      )
    }

    return NextResponse.json(parsedResponse.data)
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to save risk decision.",
        details: error instanceof Error ? error.message : "Unknown risk decision error.",
      },
      { status: 500 },
    )
  }
}

// Un-park a risk (un-snooze / un-dismiss) — the reversible half of the Archive.
export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = deleteRiskDecisionRequestSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid risk decision request", issues: parsed.error.flatten() },
      { status: 400 },
    )
  }

  try {
    const { adminClient, user } = await requireAuthenticatedUser()

    const { error } = await adminClient
      .from("risk_decisions")
      .delete()
      .eq("user_id", user.id)
      .eq("risk_type", parsed.data.riskType)
      .eq("subject_key", parsed.data.subjectKey)

    if (error) {
      throw new Error(error.message)
    }

    return NextResponse.json(deleteRiskDecisionResponseSchema.parse({ success: true }))
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 })
    }

    return NextResponse.json(
      {
        error: "Failed to clear risk decision.",
        details: error instanceof Error ? error.message : "Unknown risk decision error.",
      },
      { status: 500 },
    )
  }
}
