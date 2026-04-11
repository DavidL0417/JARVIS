"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

export function MasterInput() {
  const [message, setMessage] = useState("")

  return (
    <Card className="bg-[#141414] border-[#2a2a2a] flex-1">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-foreground">主输入</CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          用自然语言提问。我可以编辑任务、重新规划，以及保存/移除助手记忆。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col h-full">
        <div className="flex-1 bg-[#1a1a1a] rounded-lg p-3 mb-3 min-h-[120px]">
          <p className="text-sm text-muted-foreground">
            告诉我有什么变化，我会更新计划。我可以安排日程、重新规划、编辑任务，以及记住长期偏好。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Textarea
            placeholder="输入请求..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="flex-1 bg-[#1a1a1a] border-[#2a2a2a] text-foreground placeholder:text-muted-foreground resize-none min-h-[40px] h-10"
          />
          <Button className="bg-[#3b82f6] hover:bg-[#2563eb] text-white px-6">
            发送
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
