"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { DashboardCurrentTask } from "@/types"

// API Hook: Replace mockCurrentTask with fetch call here
// Example: const { data: currentTask } = useSWR('/api/tasks/current', fetcher)
const mockCurrentTask = {
  hasRecommendation: false,
  title: "No task to recommend yet.",
  subtitle: "Sync tasks and schedule to get started.",
  status: "You're all caught up.",
}

interface WhatToDoNowProps {
  currentTask?: DashboardCurrentTask | null
}

function getTaskSubtitle(status: DashboardCurrentTask["status"]) {
  if (status === "scheduled") {
    return "Live dashboard data is now driving this recommendation."
  }

  if (status === "completed") {
    return "This task is already complete."
  }

  if (status === "missed") {
    return "This task missed its planned slot and may need a replan."
  }

  return "This task is ready to be scheduled."
}

export function WhatToDoNow({ currentTask }: WhatToDoNowProps) {
  const task = currentTask
    ? {
        hasRecommendation: true,
        title: currentTask.title,
        subtitle: getTaskSubtitle(currentTask.status),
        status: `Status: ${currentTask.status}`,
      }
    : mockCurrentTask

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
      <CardHeader className="p-3 pb-1">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#3b82f6]" />
          <CardTitle className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
            What to do now
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-2 space-y-2">
        <p className="text-sm font-bold text-foreground">{task.title}</p>
        <p className="text-xs text-muted-foreground font-medium">{task.subtitle}</p>
        <p className="text-xs text-muted-foreground font-medium">{task.status}</p>
        <div className="flex gap-2 pt-1">
          <Button 
            size="sm" 
            onClick={handleDone}
            className="bg-[#3b82f6] hover:bg-[#2563eb] text-white text-xs h-7 px-3 font-semibold"
          >
            Done
          </Button>
          <Button 
            size="sm" 
            variant="outline" 
            onClick={handleSomethingElse}
            className="border-border text-foreground hover:bg-secondary text-xs h-7 px-3 font-semibold"
          >
            Something else
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
