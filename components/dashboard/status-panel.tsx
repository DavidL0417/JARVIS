"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { DashboardStats } from "@/types"

interface StatusItemProps {
  label: string
  value: string | number
}

interface StatusPanelProps {
  stats?: DashboardStats
}

function StatusItem({ label, value }: StatusItemProps) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-bold text-foreground">{value}</p>
    </div>
  )
}

function formatCheckIns(value: DashboardStats["checkInMode"]) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function StatusPanel({ stats }: StatusPanelProps) {
  const status = stats
    ? {
        checkIns: formatCheckIns(stats.checkInMode),
        overdue: stats.overdue,
        unscheduled: stats.unscheduled,
        checkInsMessage:
          stats.checkInMode === "quiet"
            ? "Fresh imports now surface in the Check-ins column when review is needed."
            : "Newly synced items are waiting for approval in the Check-ins queue.",
        overdueMessage:
          stats.overdue === 0 ? "No overdue tasks." : `${stats.overdue} tasks need attention.`,
        unscheduledMessage:
          stats.unscheduled === 0
            ? "All tasks are holding a place on the calendar."
            : `${stats.unscheduled} tasks still need time carved out.`,
      }
    : null

  return (
    <div className="space-y-3">
      <Card className="border-white/10 bg-[linear-gradient(140deg,rgba(35,19,30,0.92),rgba(47,24,57,0.78))] shadow-[0_18px_44px_rgba(0,0,0,0.18)]">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-bold text-foreground">Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          {status ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <StatusItem label="Check-ins" value={status.checkIns} />
                <StatusItem label="Overdue" value={status.overdue} />
                <StatusItem label="Unscheduled" value={status.unscheduled} />
              </div>
              <p className="text-xs font-medium text-muted-foreground">{status.checkInsMessage}</p>
            </>
          ) : (
            <p className="text-xs font-medium text-muted-foreground">
              Live dashboard status will appear here once your workspace data finishes loading.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-[linear-gradient(140deg,rgba(41,29,19,0.92),rgba(59,41,21,0.78))] shadow-[0_18px_44px_rgba(0,0,0,0.18)]">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-bold text-foreground">Overdue</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <p className="text-xs font-medium text-muted-foreground">
            {status?.overdueMessage ?? "No overdue tasks."}
          </p>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-[linear-gradient(140deg,rgba(20,29,41,0.92),rgba(24,44,63,0.78))] shadow-[0_18px_44px_rgba(0,0,0,0.18)]">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm font-bold text-foreground">Scheduling</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <p className="text-xs font-medium text-muted-foreground">
            {status?.unscheduledMessage ?? "Scheduling insights will appear here once tasks load."}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
