"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

// API Hook: Replace mockCurrentTask with fetch call here
// Example: const { data: currentTask } = useSWR('/api/tasks/current', fetcher)
const mockCurrentTask = {
  hasRecommendation: false,
  title: "No task to recommend yet.",
  subtitle: "Sync tasks and schedule to get started.",
  status: "You're all caught up.",
}

export function WhatToDoNow() {
  // API Hook: Replace mockCurrentTask with fetched data
  const task = mockCurrentTask

  // API Hook: Replace with actual action handlers
  // Example: const { trigger: markDone } = useSWRMutation('/api/tasks/done', postFetcher)
  const handleDone = () => {
    console.log("Marking task done")
  }

  const handleSomethingElse = () => {
    console.log("Something else clicked")
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="p-2 pb-1">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[#3b82f6]" />
          <CardTitle className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
            What to do now
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-2 pt-1 space-y-1">
        <p className="text-[11px] font-medium text-foreground">{task.title}</p>
        <p className="text-[9px] text-muted-foreground">{task.subtitle}</p>
        <p className="text-[9px] text-muted-foreground">{task.status}</p>
        <div className="flex gap-1.5 pt-0.5">
          <Button 
            size="sm" 
            onClick={handleDone}
            className="bg-[#3b82f6] hover:bg-[#2563eb] text-white text-[9px] h-5 px-2"
          >
            Done
          </Button>
          <Button 
            size="sm" 
            variant="outline" 
            onClick={handleSomethingElse}
            className="border-border text-foreground hover:bg-secondary text-[9px] h-5 px-2"
          >
            Something else
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
