"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

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

function StatItem({ label, value }: StatItemProps) {
  return (
    <div className="space-y-0">
      <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-foreground">{value}</p>
    </div>
  )
}

export function WorkspaceSnapshot() {
  // API Hook: Replace mockWorkspaceStats with fetched data
  const stats = mockWorkspaceStats

  return (
    <Card className="bg-card border-border">
      <CardHeader className="p-2 pb-1">
        <CardTitle className="text-[11px] font-medium text-foreground">Workspace Snapshot</CardTitle>
        <CardDescription className="text-[9px] text-muted-foreground leading-tight">
          Key counts at a glance. Open a panel below to work on one area at a time.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-2 pt-1">
        <div className="grid grid-cols-2 gap-2">
          <StatItem label="Open tasks" value={stats.openTasks} />
          <StatItem label="Inbox" value={stats.inbox} />
          <StatItem label="Overdue" value={stats.overdue} />
          <StatItem label="Check-ins" value={stats.checkIns} />
        </div>
      </CardContent>
    </Card>
  )
}
