"use client"

import { useMemo } from "react"
import { Clock3, ListTodo } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Task } from "@/types"

interface TaskQueuePopoverProps {
  tasks: Task[]
  onToggleComplete?: (task: Task) => void | Promise<void>
}

function formatDeadline(value: string | null) {
  if (!value) {
    return "No deadline"
  }

  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function TaskQueuePopover({ tasks, onToggleComplete }: TaskQueuePopoverProps) {
  const sortedTasks = useMemo(() => {
    return [...tasks].sort((left, right) => {
      const leftDeadline = left.deadline ? new Date(left.deadline).getTime() : Number.POSITIVE_INFINITY
      const rightDeadline = right.deadline ? new Date(right.deadline).getTime() : Number.POSITIVE_INFINITY

      if (leftDeadline === rightDeadline) {
        return left.title.localeCompare(right.title)
      }

      return leftDeadline - rightDeadline
    })
  }, [tasks])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 rounded-md border border-border bg-surface-subtle px-3 text-xs font-semibold text-foreground hover:bg-secondary"
        >
          <ListTodo className="mr-1.5 h-3.5 w-3.5" />
          Task Queue
          <span className="ml-2 rounded-md bg-secondary px-2 py-0.5 text-[10px] tracking-[0.18em] text-muted-foreground">
            {sortedTasks.length}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={10}
        className="w-[min(30rem,calc(100vw-2rem))] rounded-lg border-border bg-popover p-0 text-foreground shadow-xl"
      >
        <div className="border-b border-border px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-muted-foreground">
                Live Tasks
              </p>
              <h3 className="mt-1 text-base font-semibold text-foreground">
                Task queue
              </h3>
            </div>
            <div className="rounded-md border border-border bg-surface-subtle px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {sortedTasks.length} items
            </div>
          </div>
        </div>

        {sortedTasks.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm font-medium text-muted-foreground">
            No live tasks are loaded for the current dashboard session.
          </div>
        ) : (
          <ScrollArea className="h-[min(26rem,60vh)]">
            <div className="space-y-2 p-3">
              {sortedTasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-md border border-border bg-card p-3 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={task.status === "completed"}
                      onCheckedChange={() => void onToggleComplete?.(task)}
                      aria-label={task.status === "completed" ? `Mark ${task.title} incomplete` : `Mark ${task.title} complete`}
                      className="mt-1 border-2"
                    />
                    <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{task.title}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="border-border bg-surface-subtle">
                            {task.status}
                          </Badge>
                          <Badge variant="outline" className="border-border bg-surface-subtle">
                            {task.priority}
                          </Badge>
                          {task.tags.slice(0, 2).map((tag) => (
                            <Badge key={tag} variant="outline" className="border-border bg-surface-subtle">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface-subtle px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                        <Clock3 className="h-3.5 w-3.5" />
                        {formatDeadline(task.deadline)}
                      </div>
                    </div>
                  </div>

                  {task.description ? (
                    <p className="mt-2 line-clamp-2 pl-8 text-xs font-medium text-muted-foreground">
                      {task.description}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  )
}
