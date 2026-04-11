"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

interface StatItemProps {
  label: string
  value: string | number
}

function StatItem({ label, value }: StatItemProps) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold text-foreground">{value}</p>
    </div>
  )
}

export function WorkspaceSnapshot() {
  return (
    <Card className="bg-[#141414] border-[#2a2a2a]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-foreground">工作空间概览</CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          关键数据一览。点击下方面板专注处理。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <StatItem label="待办任务" value={23} />
          <StatItem label="收件箱" value={0} />
          <StatItem label="已逾期" value={0} />
          <StatItem label="签到" value="静默" />
        </div>
      </CardContent>
    </Card>
  )
}
