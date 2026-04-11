"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import type { DashboardStats } from "@/types"

// API Hook: Replace mockWorkspaceStats with fetch call here
// Example: const { data: stats } = useSWR('/api/workspace/stats', fetcher)
const mockWorkspaceStats = {
  openTasks: 23,
  inbox: 0,
  overdue: 0,
  checkIns: "Quiet",
}

interface StatItemProps {
  label: string
  value: string | number
}

interface WorkspaceSnapshotProps {
  stats?: DashboardStats
}

function StatItem({ label, value }: StatItemProps) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-semibold">{label}</p>
      <p className="text-base font-bold text-foreground">{value}</p>
    </div>
  )
}

function formatCheckIns(value: DashboardStats["checkInMode"]) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function WorkspaceSnapshot({ stats }: WorkspaceSnapshotProps) {
  const workspaceStats = stats
    ? {
        openTasks: stats.tasks,
        inbox: 0,
        overdue: stats.overdue,
        checkIns: formatCheckIns(stats.checkInMode),
      }
    : mockWorkspaceStats

  return (
    <Card className="bg-card border-border">
      <CardHeader className="p-3 pb-1">
        <CardTitle className="text-sm font-bold text-foreground">Workspace Snapshot</CardTitle>
        <CardDescription className="text-xs text-muted-foreground leading-tight font-medium">
          Key counts at a glance. Open a panel below to work on one area at a time.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-3 pt-2">
        <div className="grid grid-cols-2 gap-3">
          <StatItem label="Open tasks" value={workspaceStats.openTasks} />
          <StatItem label="Inbox" value={workspaceStats.inbox} />
          <StatItem label="Overdue" value={workspaceStats.overdue} />
          <StatItem label="Check-ins" value={workspaceStats.checkIns} />
        </div>
      </CardContent>
    </Card>
  )
}
