"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface StatusItemProps {
  label: string
  value: string | number
}

function StatusItem({ label, value }: StatusItemProps) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold text-foreground">{value}</p>
    </div>
  )
}

export function StatusPanel() {
  return (
    <div className="space-y-4">
      {/* Status Grid */}
      <Card className="bg-[#141414] border-[#2a2a2a]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-foreground">状态</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <StatusItem label="签到" value="静默" />
            <StatusItem label="已逾期" value={0} />
            <StatusItem label="未安排" value={0} />
          </div>
        </CardContent>
      </Card>

      {/* Check-ins */}
      <Card className="bg-[#141414] border-[#2a2a2a]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-foreground">签到</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">暂无需签到。</p>
        </CardContent>
      </Card>

      {/* Overdue */}
      <Card className="bg-[#141414] border-[#2a2a2a]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-foreground">已逾期</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">无逾期任务。</p>
        </CardContent>
      </Card>

      {/* Missing explicit estimates */}
      <Card className="bg-[#141414] border-[#2a2a2a]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-foreground">缺少明确估算</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            所有任务都有估算或标题时长提示。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
