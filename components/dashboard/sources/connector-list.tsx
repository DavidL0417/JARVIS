"use client"

import type { ReactNode } from "react"
import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  FileUp,
  Github,
  GraduationCap,
  ListChecks,
  Mail,
  MessageSquare,
  StickyNote,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
  BetaBadge,
  connectorStatusDotTone,
  ConnectorStatusMark,
  type ConnectorDefinition,
  type ConnectorState,
} from "@/components/dashboard/sources/shared"

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
    beta: true,
  },
  {
    id: "apple_reminders",
    title: "Apple Reminders",
    group: "tasks_courses",
    icon: CheckCircle2,
    summary: "Sync your iPhone reminders into tasks via a Shortcut you jot into on the go.",
    beta: true,
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
  {
    id: "imessage",
    title: "iMessage",
    group: "operator",
    icon: MessageSquare,
    summary:
      "Operator-only: forward allowlisted iMessage/SMS conversations into JARVIS as full-text context and scheduler candidates. Everything else is dropped on your Mac.",
    beta: true,
  },
  {
    id: "raycast",
    title: "Raycast",
    group: "operator",
    icon: StickyNote,
    summary:
      "Operator-only: mirror your Raycast Notes scratchpad into JARVIS as read-only ambient context. One-way, never turned into tasks.",
    beta: true,
  },
]

export type ConnectorGroupKey = ConnectorDefinition["group"]

// Display order + labels for the collapsible source drawers. Keep this in sync
// with the `group` values on CONNECTOR_DEFINITIONS above.
export const CONNECTOR_GROUPS: { key: ConnectorGroupKey; label: string }[] = [
  { key: "calendar", label: "Calendar" },
  { key: "tasks_courses", label: "Tasks & Courses" },
  { key: "work_context", label: "Work Context" },
  { key: "files", label: "Files" },
  { key: "operator", label: "Operator" },
  { key: "developing", label: "In Development" },
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
      {connector.beta ? <BetaBadge /> : null}
      <ConnectorStatusMark state={state} />
    </button>
  )
}

// A compact health summary for a collapsed group: one dot per source, tinted by
// the same status palette the rows use. Lets a glance at a closed drawer tell you
// what's connected, what needs attention, and what's still in development.
function ConnectorStatusDots({ states }: { states: ConnectorState[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
      {states.map((state, index) => (
        <span key={index} className={cn("inline-block h-1.5 w-1.5 rounded-full", connectorStatusDotTone(state))} />
      ))}
    </span>
  )
}

export function ConnectorGroup({
  title,
  states,
  open,
  onToggle,
  children,
}: {
  title: string
  states: ConnectorState[]
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className="flex flex-col">
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="group/group flex w-full items-center gap-2 border-b border-rule/70 py-2.5 pl-3 pr-2 text-left transition-colors hover:bg-secondary/10"
        >
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform",
              open && "rotate-90",
            )}
            aria-hidden="true"
            strokeWidth={2}
          />
          <span className="flex-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70 transition-colors group-hover/group:text-foreground/80">
            {title}
          </span>
          {open ? null : <ConnectorStatusDots states={states} />}
          <span className="num w-3 text-right text-[10px] font-medium tabular-nums text-muted-foreground/60">
            {states.length}
          </span>
        </button>
      </h3>
      {open ? <div className="flex flex-col">{children}</div> : null}
    </div>
  )
}
