"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { DashboardStats } from "@/types"

// API Hook: Replace mockStatusData with fetch call here
// Example: const { data: status } = useSWR('/api/status', fetcher)
const mockStatusData = {
  checkIns: "Quiet",
  overdue: 0,
  unscheduled: 0,
  checkInsMessage: "No check-ins needed yet.",
  overdueMessage: "No overdue tasks.",
  estimatesMessage: "All tasks have an estimate or title duration hint.",
}

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
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">{label}</p>
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
        checkInsMessage: "Backend check-in state is connected to the dashboard mock endpoint.",
        overdueMessage:
          stats.overdue === 0 ? "No overdue tasks." : `${stats.overdue} tasks need attention.`,
        estimatesMessage:
          stats.unscheduled === 0
            ? "All tasks are currently scheduled."
            : `${stats.unscheduled} tasks are still waiting for a slot.`,
      }
    : mockStatusData

  return (
    <div className="space-y-3">
      {/* Status Grid */}
      <Card className="bg-card border-border">
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-sm font-bold text-foreground">Status</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <StatusItem label="Check-ins" value={status.checkIns} />
            <StatusItem label="Overdue" value={status.overdue} />
            <StatusItem label="Unscheduled" value={status.unscheduled} />
          </div>
        </CardContent>
      </Card>

      {/* Check-ins */}
      <Card className="bg-card border-border">
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-sm font-bold text-foreground">Check-ins</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-2">
          <p className="text-xs text-muted-foreground font-medium">{status.checkInsMessage}</p>
        </CardContent>
      </Card>

      {/* Overdue */}
      <Card className="bg-card border-border">
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-sm font-bold text-foreground">Overdue</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-2">
          <p className="text-xs text-muted-foreground font-medium">{status.overdueMessage}</p>
        </CardContent>
      </Card>

      {/* Missing explicit estimates */}
      <Card className="bg-card border-border">
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-sm font-bold text-foreground">Missing explicit estimates</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-2">
          <p className="text-xs text-muted-foreground font-medium">{status.estimatesMessage}</p>
        </CardContent>
      </Card>
    </div>
  )
}
