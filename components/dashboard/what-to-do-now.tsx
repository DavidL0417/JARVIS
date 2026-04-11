"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export function WhatToDoNow() {
  return (
    <Card className="bg-[#141414] border-[#2a2a2a]">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#3b82f6]" />
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            现在该做什么
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm font-medium text-foreground">暂无推荐任务。</p>
        <p className="text-xs text-muted-foreground">同步任务并安排日程以开始。</p>
        <p className="text-xs text-muted-foreground">你已经全部完成了。</p>
        <div className="flex gap-2 pt-2">
          <Button size="sm" className="bg-[#3b82f6] hover:bg-[#2563eb] text-white text-xs h-8">
            完成
          </Button>
          <Button 
            size="sm" 
            variant="outline" 
            className="border-[#2a2a2a] text-foreground hover:bg-[#1f1f1f] text-xs h-8"
          >
            其他
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
