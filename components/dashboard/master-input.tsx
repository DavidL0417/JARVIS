"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

export function MasterInput() {
  const [message, setMessage] = useState("")

  // API Hook: Replace with actual submission handler
  // Example: const { trigger: submitMessage } = useSWRMutation('/api/assistant/message', postFetcher)
  const handleSubmit = async () => {
    if (!message.trim()) return
    // API Hook: Call submitMessage(message) here
    console.log("Submitting message:", message)
    setMessage("")
  }

  return (
    <Card className="bg-[#141414] border-[#2a2a2a] flex-1">
      <CardHeader className="p-3 pb-1">
        <CardTitle className="text-xs font-medium text-foreground">Master Input</CardTitle>
        <CardDescription className="text-[10px] text-muted-foreground leading-tight">
          Ask in plain language. I can edit tasks, replan, and save/remove assistant memory.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-3 pt-2 flex flex-col">
        <div className="bg-[#1a1a1a] rounded-md p-2 mb-2 min-h-[80px]">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Tell me what changed and I&apos;ll update the plan. I can schedule, replan, edit tasks, and remember long-term preferences.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Textarea
            placeholder="Type a request..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="flex-1 bg-[#1a1a1a] border-[#2a2a2a] text-foreground placeholder:text-muted-foreground resize-none min-h-[32px] h-8 text-xs py-2"
          />
          <Button 
            onClick={handleSubmit}
            className="bg-[#3b82f6] hover:bg-[#2563eb] text-white px-4 h-8 text-xs"
          >
            Send
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
