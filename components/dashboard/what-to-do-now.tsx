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
    <Card className="overflow-hidden border-white/10 bg-[linear-gradient(140deg,rgba(35,20,18,0.92),rgba(61,33,47,0.78))] shadow-[0_18px_44px_rgba(0,0,0,0.18)]">
      <CardHeader className="p-4 pb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-orange-300 shadow-[0_0_14px_rgba(253,186,116,0.7)]" />
          <CardTitle className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
            What to do now
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 p-4 pt-0">
        <p className="text-base font-bold text-foreground">{task.title}</p>
        <p className="text-xs text-muted-foreground font-medium">{task.subtitle}</p>
        <p className="inline-flex rounded-full border border-white/10 bg-black/15 px-2 py-1 text-[11px] text-muted-foreground font-medium">
          {task.status}
        </p>
        <div className="flex gap-2 pt-1">
          <Button 
            size="sm" 
            onClick={handleDone}
            className="h-8 bg-gradient-to-r from-orange-300 via-rose-300 to-fuchsia-300 px-3 text-xs font-semibold text-slate-950 hover:from-orange-300 hover:via-rose-300 hover:to-fuchsia-300"
          >
            Done
          </Button>
          <Button 
            size="sm" 
            variant="outline" 
            onClick={handleSomethingElse}
            className="h-8 border-white/10 bg-white/[0.03] px-3 text-xs font-semibold text-foreground hover:bg-white/[0.07]"
          >
            Something else
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
