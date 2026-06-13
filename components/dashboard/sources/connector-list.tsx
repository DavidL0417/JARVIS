"use client"

import type { ReactNode } from "react"
import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  FileUp,
  Github,
  GraduationCap,
  ListChecks,
  Mail,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { ConnectorStatusMark, type ConnectorDefinition, type ConnectorState } from "@/components/dashboard/sources/shared"

export const CONNECTOR_DEFINITIONS: ConnectorDefinition[] = [
  {
    id: "google_calendar",
    title: "Google Calendar",
    group: "calendar",
    icon: CalendarDays,
    summary: "Mirror calendar commitments for planning constraints, conflicts, and task-block sync.",
  },
  {
    id: "caldav",
    title: "CalDAV",
    group: "calendar",
    icon: CalendarDays,
    summary: "Mirror Apple, Fastmail, Nextcloud, and other CalDAV calendars as read-only planning constraints.",
  },
  {
    id: "outlook_calendar",
    title: "Outlook Calendar",
    group: "calendar",
    icon: CalendarDays,
    summary: "Outlook calendar sync is being developed.",
  },
  {
    id: "gmail",
    title: "Gmail",
    group: "work_context",
    icon: Mail,
    summary: "Scan recent mail for planning context, replies, logistics, and deadlines.",
  },
  {
    id: "notion",
    title: "Notion",
    group: "tasks_courses",
    icon: BookOpen,
    summary: "Import tasks from the authoritative Notion tasks database.",
  },
  {
    id: "canvas",
    title: "Canvas",
    group: "tasks_courses",
    icon: GraduationCap,
    summary: "Import planner items from Canvas and sync completed planner items back.",
  },
  {
    id: "apple_reminders",
    title: "Apple Reminders",
    group: "tasks_courses",
    icon: CheckCircle2,
    summary: "Sync your iPhone reminders into tasks via a Shortcut you jot into on the go.",
  },
  {
    id: "manual",
    title: "Manual context",
    group: "files",
    icon: FileUp,
    summary: "Upload or paste one-off source material.",
  },
  {
    id: "todoist",
    title: "Todoist",
    group: "developing",
    icon: ListChecks,
    summary: "Task sync is being developed.",
  },
  {
    id: "google_tasks",
    title: "Google Tasks",
    group: "developing",
    icon: CheckCircle2,
    summary: "Google task list sync is being developed.",
  },
  {
    id: "microsoft_todo",
    title: "Microsoft To Do",
    group: "developing",
    icon: CheckCircle2,
    summary: "Microsoft task sync is being developed.",
  },
  {
    id: "ticktick",
    title: "TickTick",
    group: "developing",
    icon: ListChecks,
    summary: "TickTick task sync is being developed.",
  },
  {
    id: "things_3",
    title: "Things 3",
    group: "developing",
    icon: ListChecks,
    summary: "Local Things 3 task sync is being developed.",
  },
  {
    id: "linear",
    title: "Linear",
    group: "work_context",
    icon: ListChecks,
    summary: "Issue context sync is being developed.",
  },
  {
    id: "github",
    title: "GitHub",
    group: "work_context",
    icon: Github,
    summary: "Repository and issue context sync is being developed.",
  },
]

export function ConnectorRow({
  connector,
  state,
  active,
  onSelect,
}: {
  connector: ConnectorDefinition
  state: ConnectorState
  active: boolean
  onSelect: () => void
}) {
  const Icon = connector.icon

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group flex w-full min-w-0 items-center gap-3 border-b border-rule/70 py-2.5 pl-3 pr-2 text-left transition-colors",
        active ? "bg-secondary/25" : "hover:bg-secondary/15",
      )}
      aria-pressed={active}
    >
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0 transition-colors",
          active ? "text-copper" : "text-muted-foreground/70 group-hover:text-foreground/80",
        )}
        aria-hidden="true"
        strokeWidth={1.75}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px] font-medium transition-colors",
          active ? "text-foreground" : "text-foreground/85",
        )}
      >
        {connector.title}
      </span>
      <ConnectorStatusMark state={state} />
    </button>
  )
}

export function ConnectorGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <h3 className="border-b border-rule/70 pb-2 pl-3 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
        {title}
      </h3>
      {children}
    </div>
  )
}
