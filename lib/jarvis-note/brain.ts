import { classifySecretaryIntent, type SecretaryIntent } from "@/lib/assistant/orchestrator"
import { runSecretaryTurn } from "@/lib/assistant/secretary"
import { enqueueCommand, mintAckToken, renderConfirmText } from "@/lib/jarvis-note/commands"
import { createSupabaseAdminClient } from "@/lib/supabase/server"
import type { AssistantConversationEntry } from "@/types"

// The "brain" for the JARVIS note. It routes lines David writes in the note through
// the SAME secretary brain the in-app Cmd+K surface uses (classifySecretaryIntent +
// runSecretaryTurn) — that is the "one brain, two surfaces" unification — and turns
// the outcome into note commands (the P2 control channel writes them back):
//
//   • read/answer requests   → run the brain now, append the reply to the note.
//   • mutating actions        → enqueue a "⚠️ Confirm: …?" checkbox; David ticks it;
//                               the ack runs the action, appends the result, and
//                               deletes the confirm + original line (deletion = done).
//
// The JARVIS note is the command surface (David's freeform scratchpad lives in the
// OTHER Raycast notes), so every NEW David line is treated as a request. See
// docs/decisions/jarvis-note-daemon.md.

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

const COMMANDS_TABLE = "jarvis_note_commands"
// Safety cap: never fan out more than this many brain turns from one capture.
const MAX_LINES_PER_CAPTURE = 10

// Intents that change state and therefore go through the confirm handshake. The
// rest (answer, read_messages, review_feedback, refresh_sources, classification_error)
// are answered/run directly — they're read-ish or benign.
const MUTATING_KINDS = new Set<SecretaryIntent["kind"]>([
  "create_task",
  "remember",
  "plan_day",
  "request_external_write",
  "pause_automations",
  "resume_automations",
  "log_activity",
])

export function isMutatingIntent(intent: SecretaryIntent): boolean {
  return MUTATING_KINDS.has(intent.kind)
}

// A short, human action summary for the confirm checkbox.
export function confirmActionText(line: string, intent: SecretaryIntent): string {
  switch (intent.kind) {
    case "create_task":
      return `add task "${intent.title}"`
    case "remember":
      return `remember "${intent.content}"`
    case "plan_day":
      return "rebuild today's plan"
    case "pause_automations":
      return "pause automations"
    case "resume_automations":
      return "resume automations"
    case "log_activity":
      return `log activity "${intent.activity}"`
    case "request_external_write":
      return `external write: ${intent.command}`
    default:
      return line.trim()
  }
}

// The reply line written back to the note — icon-tagged so it reads as agent-authored
// (and so the daemon/Scheduler never mistake it for David's own line).
export function replyAppendLine(reply: string): string {
  const oneLine = reply.replace(/\s+/g, " ").trim()
  return `📝 ${oneLine}`
}

// New David lines = current authored-user lines not present in the previous capture.
// Cheap, schema-free change detection; an edited line reads as new (acceptable v1).
export function diffNewUserLines(current: string[], previous: string[]): string[] {
  const seen = new Set(previous.map((l) => l.trim()))
  const out: string[] = []
  for (const line of current) {
    const t = line.trim()
    if (t && !seen.has(t)) {
      out.push(t)
      seen.add(t) // dedupe within this capture too
    }
  }
  return out
}

// Ports — the side effects the brain needs. Injected so the orchestration is unit
// testable without a live DB or the AI.
export interface JarvisBrainContext {
  classifyIntent(line: string): Promise<SecretaryIntent>
  answer(line: string): Promise<{ reply: string; ok: boolean }>
  // Append one ready-to-write line to the note (already icon-tagged by the caller).
  appendLine(line: string): Promise<void>
  enqueueConfirm(action: string, sourceLine: string): Promise<void>
  hasOpenConfirm(sourceLine: string): Promise<boolean>
  ackedConfirms(tokens: string[]): Promise<Array<{ sourceLine: string; confirmText: string }>>
  deleteLines(match: string[]): Promise<void>
}

export interface BrainResult {
  answered: string[]
  confirmed: string[]
  executed: string[]
}

export async function runBrainOnCapture(
  ctx: JarvisBrainContext,
  input: { currentUserLines: string[]; previousUserLines: string[]; ackedTokens: string[] },
): Promise<BrainResult> {
  const result: BrainResult = { answered: [], confirmed: [], executed: [] }

  // 1) Acks first: a ticked confirm runs its deferred action, appends the result,
  // and deletes the confirm + the original line (deletion is the done-signal).
  if (input.ackedTokens.length > 0) {
    const confirms = await ctx.ackedConfirms(input.ackedTokens)
    for (const confirm of confirms) {
      const { reply } = await ctx.answer(confirm.sourceLine)
      await ctx.appendLine(replyAppendLine(reply))
      await ctx.deleteLines([confirm.confirmText, confirm.sourceLine])
      result.executed.push(confirm.sourceLine)
    }
  }

  // 2) New lines: classify, then answer directly or gate behind a confirm.
  const newLines = diffNewUserLines(input.currentUserLines, input.previousUserLines).slice(0, MAX_LINES_PER_CAPTURE)
  for (const line of newLines) {
    const intent = await ctx.classifyIntent(line)
    if (isMutatingIntent(intent)) {
      if (await ctx.hasOpenConfirm(line)) {
        continue // a confirm for this exact line is already outstanding
      }
      await ctx.enqueueConfirm(confirmActionText(line, intent), line)
      result.confirmed.push(line)
    } else {
      const { reply } = await ctx.answer(line)
      await ctx.appendLine(replyAppendLine(reply))
      result.answered.push(line)
    }
  }

  return result
}

// David's own lines from a set of parsed capture items (agent/icon-tagged lines,
// including our own replies + confirm checkboxes, are excluded).
export function userLinesFromItems(items: Array<{ text: string; authored?: string | null }>): string[] {
  return items.filter((item) => item.authored !== "agent").map((item) => item.text.trim()).filter(Boolean)
}

// David's lines from the most recent stored capture — the baseline for the
// new-line diff. MUST be read BEFORE the current capture is inserted.
export async function getPreviousCaptureUserLines(adminClient: AdminClient, userId: string): Promise<string[]> {
  const { data, error } = await adminClient
    .from("jarvis_note_captures")
    .select("items")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    throw new Error(error.message)
  }
  const items = (data?.items ?? []) as Array<{ text: string; authored?: string | null }>
  return userLinesFromItems(items)
}

const EMPTY_HISTORY: AssistantConversationEntry[] = []

// Wire the ports to the real brain + command queue for a given operator user.
export function createJarvisBrainContext(adminClient: AdminClient, userId: string): JarvisBrainContext {
  return {
    classifyIntent: (line) =>
      classifySecretaryIntent({ message: line, now: null, timezone: null, history: EMPTY_HISTORY }),

    answer: async (line) => {
      const turn = await runSecretaryTurn({
        supabase: adminClient,
        userId,
        message: line,
        now: null,
        timezone: null,
        history: EMPTY_HISTORY,
      })
      return { reply: turn.reply, ok: turn.ok }
    },

    appendLine: async (line) => {
      await enqueueCommand(adminClient, userId, { kind: "append", payload: { lines: [line] } })
    },

    enqueueConfirm: async (action, sourceLine) => {
      const ackToken = mintAckToken()
      const confirmText = renderConfirmText(action, ackToken)
      // sourceLine + confirmText ride in the payload so the ack can run the deferred
      // action and delete both lines. The confirm schema ignores the extra keys.
      await enqueueCommand(adminClient, userId, {
        kind: "confirm",
        payload: { action, confirmText, sourceLine },
        requiresAck: true,
        ackToken,
      })
    },

    hasOpenConfirm: async (sourceLine) => {
      const { data, error } = await adminClient
        .from(COMMANDS_TABLE)
        .select("id")
        .eq("user_id", userId)
        .eq("kind", "confirm")
        .eq("payload->>sourceLine", sourceLine)
        .is("acked_at", null)
        .in("status", ["pending", "claimed"])
        .limit(1)
        .maybeSingle()
      if (error) {
        throw new Error(error.message)
      }
      return Boolean(data)
    },

    ackedConfirms: async (tokens) => {
      if (tokens.length === 0) {
        return []
      }
      const { data, error } = await adminClient
        .from(COMMANDS_TABLE)
        .select("payload")
        .eq("user_id", userId)
        .eq("kind", "confirm")
        .in("ack_token", tokens)
      if (error) {
        throw new Error(error.message)
      }
      return (data ?? [])
        .map((row: { payload: Record<string, unknown> | null }) => row.payload ?? {})
        .filter((p) => typeof p.sourceLine === "string" && typeof p.confirmText === "string")
        .map((p) => ({ sourceLine: p.sourceLine as string, confirmText: p.confirmText as string }))
    },

    deleteLines: async (match) => {
      await enqueueCommand(adminClient, userId, { kind: "delete_lines", payload: { match } })
    },
  }
}
