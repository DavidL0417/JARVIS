"use client"

import { useMemo } from "react"
import { CalendarClock, ListTodo } from "lucide-react"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { TaskCheckbox } from "@/components/dashboard/task-row"
import type { Task } from "@/types"

interface TaskQueuePopoverProps {
  tasks: Task[]
  onToggleComplete?: (task: Task) => void | Promise<void>
}

function formatDeadline(value: string | null) {
  if (!value) {
    return null
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
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Task queue"
              className="flex h-8 items-center gap-1.5 rounded-sm border border-rule px-2.5 text-[12px] text-foreground hover:bg-accent hover:border-rule-strong"
            >
              <ListTodo className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
              <span className="num text-[11px] font-medium uppercase text-muted-foreground">
                {sortedTasks.length}
              </span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-[11px]">Task queue</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[min(28rem,calc(100vw-2rem))] border-rule bg-popover p-0 text-popover-foreground"
      >
        <div className="border-b border-rule-strong px-3.5 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="eyebrow">Queue</h3>
            <span className="num text-[11px] font-medium uppercase text-muted-foreground">
              {sortedTasks.length}
            </span>
          </div>
        </div>

        {sortedTasks.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">No live tasks.</p>
        ) : (
          <ScrollArea className="h-[min(24rem,60vh)]">
            <ul>
              {sortedTasks.map((task, index) => {
                const deadlineLabel = formatDeadline(task.deadline)
                return (
                  <li
                    key={task.id}
                    className="flex items-baseline gap-3 border-b border-rule px-3.5 py-2.5 last:border-b-0"
                  >
                    <span className="num w-6 shrink-0 text-[11px] font-medium uppercase text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <TaskCheckbox
                      checked={task.status === "completed"}
                      onToggle={() => onToggleComplete?.(task)}
                      className="mt-0.5 rounded-sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-[14px] ${
                          task.status === "completed"
                            ? "text-muted-foreground line-through"
                            : "text-foreground"
                        }`}
                      >
                        {task.title}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span className="num font-medium uppercase">{task.priority}</span>
                        {deadlineLabel ? (
                          <span className="num inline-flex items-center gap-1">
                            <CalendarClock className="h-3 w-3" />
                            {deadlineLabel}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  )
}
