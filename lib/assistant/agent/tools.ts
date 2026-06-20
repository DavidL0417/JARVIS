import type Anthropic from "@anthropic-ai/sdk"

// The agent's tool catalog. Tiers drive both surface gating and the confirm
// posture decided with David (2026-06-19):
//   • read     — always available, both surfaces. No mutation.
//   • write    — INTERNAL edits (tasks, plan, memory). Auto-execute in the in-app
//                Cmd+K surface ("just do it"); withheld on the note surface, whose
//                own ⚠️ Confirm-checkbox handshake gates mutations.
//   • external — leaves the app (Google Calendar). Never auto-executes; queues a
//                pending_approval the user approves.
export type AgentToolTier = "read" | "write" | "external"
export type AgentSurface = "interactive" | "note"

export interface AgentToolSpec {
  name: string
  tier: AgentToolTier
  definition: Anthropic.Tool
}

const ISO_OR_NATURAL =
  "ISO-8601 timestamp with timezone offset (compute it from the provided `now` and `timezone`). Natural language like 'tomorrow 3pm' is also accepted. Pass null to clear."

const TOOLS: AgentToolSpec[] = [
  {
    name: "find_tasks",
    tier: "read",
    definition: {
      name: "find_tasks",
      description:
        "Search the user's tasks to resolve a reference (e.g. 'the dinner task') to its id and current fields BEFORE acting. Returns id, title, status, priority, deadline, scheduledFor, durationMinutes, isImmutable, source. Use this whenever the user refers to a task you need the id for.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "Words to match against task titles. Omit to list active tasks." },
          status: {
            type: "string",
            enum: ["todo", "scheduled", "completed", "missed", "any"],
            description: "Filter by status. Defaults to active (todo+scheduled).",
          },
          limit: { type: "integer", minimum: 1, maximum: 25, description: "Max tasks to return (default 10)." },
        },
        required: [],
      },
    },
  },
  {
    name: "get_schedule",
    tier: "read",
    definition: {
      name: "get_schedule",
      description:
        "List the user's calendar events / scheduled blocks in a time window to check availability or what's planned. Returns title, start, end, source (task|calendar), immutable.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          startIso: { type: "string", description: "Window start, ISO-8601. Defaults to now." },
          endIso: { type: "string", description: "Window end, ISO-8601. Defaults to 7 days from now." },
        },
        required: [],
      },
    },
  },
  {
    name: "search_gmail",
    tier: "read",
    definition: {
      name: "search_gmail",
      description:
        "Search the user's Gmail in real time to answer a question (e.g. 'did Professor Lee email me about the exam?'). `query` uses Gmail search syntax (from:, subject:, newer_than:7d, etc.). Returns matching messages with from, subject, date, snippet, body. Read-only — you cannot send mail.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "Gmail search query, e.g. 'from:professor newer_than:14d exam'." },
          maxResults: { type: "integer", minimum: 1, maximum: 15, description: "Max messages (default 8)." },
        },
        required: ["query"],
      },
    },
  },
  {
    name: "read_imessage",
    tier: "read",
    definition: {
      name: "read_imessage",
      description:
        "Read the archived iMessage/SMS thread with a contact on the user's allowlist to answer 'what did X say'. Returns the conversation oldest-first ('Me' is the user). Read-only — you cannot send texts.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          contact: { type: "string", description: "Contact name or handle to look up." },
        },
        required: ["contact"],
      },
    },
  },
  {
    name: "update_task",
    tier: "write",
    definition: {
      name: "update_task",
      description:
        "Edit a task's fields directly — rename, set/clear a deadline, schedule it for a time, change priority or duration, mark it done, or lock it. Resolve the taskId with find_tasks first. Immutable tasks (real appointments) should not be rescheduled. Apply the change; do not ask permission for internal edits.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          taskId: { type: "string", description: "The task id (from find_tasks)." },
          title: { type: "string", description: "New title." },
          deadline: { type: ["string", "null"], description: `When it is due. ${ISO_OR_NATURAL}` },
          scheduledFor: { type: ["string", "null"], description: `When the user plans to do it. ${ISO_OR_NATURAL}` },
          priority: { type: "string", enum: ["low", "medium", "high"] },
          durationMinutes: { type: ["integer", "null"], minimum: 1, description: "Estimated minutes." },
          status: { type: "string", enum: ["todo", "scheduled", "completed", "missed"] },
          isImmutable: { type: "boolean", description: "Lock the task so the planner won't move it (use for real appointments)." },
        },
        required: ["taskId"],
      },
    },
  },
  {
    name: "create_task",
    tier: "write",
    definition: {
      name: "create_task",
      description:
        "Create a new JARVIS task. For a timed item the user owns (e.g. 'dinner Friday 7pm') set scheduledFor and isImmutable=true with no deadline, so the planner treats it as a fixed block it won't reschedule.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", description: "Task title." },
          priority: { type: "string", enum: ["low", "medium", "high"] },
          deadline: { type: ["string", "null"], description: `When it is due. ${ISO_OR_NATURAL}` },
          scheduledFor: { type: ["string", "null"], description: `When to do it. ${ISO_OR_NATURAL}` },
          durationMinutes: { type: ["integer", "null"], minimum: 1 },
          isImmutable: { type: "boolean", description: "Lock as a fixed block (real appointment)." },
          allDay: { type: "boolean" },
        },
        required: ["title"],
      },
    },
  },
  {
    name: "complete_task",
    tier: "write",
    definition: {
      name: "complete_task",
      description: "Mark a task done (also flips its linked Notion/Canvas item). Resolve the taskId with find_tasks first.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          taskId: { type: "string", description: "The task id (from find_tasks)." },
        },
        required: ["taskId"],
      },
    },
  },
  {
    name: "plan_day",
    tier: "write",
    definition: {
      name: "plan_day",
      description:
        "Rebuild the user's daily plan / schedule, optionally shaped by a command ('protect the morning', 'lighter day', 'fit in the essay'). Use when the user asks to (re)plan or reschedule around their tasks.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          command: { type: "string", description: "Optional shaping instruction for the planner." },
        },
        required: [],
      },
    },
  },
  {
    name: "remember",
    tier: "write",
    definition: {
      name: "remember",
      description:
        "Save a durable preference or fact about the user that should shape future scheduling/behavior (e.g. 'I focus best before noon'). Only for lasting preferences, not one-off task content.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          content: { type: "string", description: "The preference/fact to remember." },
        },
        required: ["content"],
      },
    },
  },
  {
    name: "sync_tasks_to_google",
    tier: "external",
    definition: {
      name: "sync_tasks_to_google",
      description:
        "Queue an approval to push the user's scheduled JARVIS task blocks to their Google Calendar. This does NOT write immediately — it creates a pending approval the user confirms. Use only when the user explicitly wants their blocks on Google Calendar.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          reason: { type: "string", description: "Short note on why, shown to the user." },
        },
        required: [],
      },
    },
  },
]

const TOOL_BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]))

export function getAgentToolSpec(name: string): AgentToolSpec | undefined {
  return TOOL_BY_NAME.get(name)
}

export function getAgentToolTier(name: string): AgentToolTier | undefined {
  return TOOL_BY_NAME.get(name)?.tier
}

// Tools offered to the model for a surface. The note surface is read-only: its
// mutations flow through the daemon's own confirm-checkbox handshake, so we never
// hand it write/external tools that would bypass that gate.
export function getAgentTools(surface: AgentSurface): Anthropic.Tool[] {
  const allowed = surface === "interactive" ? TOOLS : TOOLS.filter((tool) => tool.tier === "read")
  return allowed.map((tool) => tool.definition)
}

export function isToolAllowedForSurface(name: string, surface: AgentSurface): boolean {
  const tier = getAgentToolTier(name)
  if (!tier) return false
  return surface === "interactive" || tier === "read"
}
