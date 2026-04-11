import { NextResponse } from "next/server"

import { dashboardResponseSchema } from "@/schemas/dashboard"
import type { DashboardResponse } from "@/types"

export async function GET() {
  const dashboardPayload: DashboardResponse = {
    stats: {
      tasks: 23,
      overdue: 0,
      unscheduled: 2,
      checkins: "silent",
    },
    currentTask: {
      id: "task-finish-hackathon-backend",
      title: "Finish hackathon backend",
      status: "scheduled",
    },
    events: [],
  }

  const parsedPayload = dashboardResponseSchema.safeParse(dashboardPayload)

  if (!parsedPayload.success) {
    return NextResponse.json(
      {
        error: "Invalid dashboard response payload",
        issues: parsedPayload.error.flatten(),
      },
      { status: 500 },
    )
  }

  return NextResponse.json(parsedPayload.data)
}
