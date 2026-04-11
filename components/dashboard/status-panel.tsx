"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

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

function StatusItem({ label, value }: StatusItemProps) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-foreground">{value}</p>
    </div>
  )
}

export function StatusPanel() {
  // API Hook: Replace mockStatusData with fetched data
  const status = mockStatusData

  return (
    <div className="space-y-3">
      {/* Status Grid */}
      <Card className="bg-[#141414] border-[#2a2a2a]">
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-xs font-medium text-foreground">Status</CardTitle>
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
      <Card className="bg-[#141414] border-[#2a2a2a]">
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-xs font-medium text-foreground">Check-ins</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-2">
          <p className="text-[11px] text-muted-foreground">{status.checkInsMessage}</p>
        </CardContent>
      </Card>

      {/* Overdue */}
      <Card className="bg-[#141414] border-[#2a2a2a]">
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-xs font-medium text-foreground">Overdue</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-2">
          <p className="text-[11px] text-muted-foreground">{status.overdueMessage}</p>
        </CardContent>
      </Card>

      {/* Missing explicit estimates */}
      <Card className="bg-[#141414] border-[#2a2a2a]">
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-xs font-medium text-foreground">Missing explicit estimates</CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-2">
          <p className="text-[11px] text-muted-foreground">{status.estimatesMessage}</p>
        </CardContent>
      </Card>
    </div>
  )
}
