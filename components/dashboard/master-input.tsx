"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import { ArrowUp, Check, ChevronDown, Loader2, X } from "lucide-react"

import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type {
  AssistantContextResponse,
  AssistantMessageRequest,
  AssistantMessageResponse,
  Task,
} from "@/types"

type SubmitStatus = "idle" | "submitting" | "error"
type ApprovalAction = "approve" | "cancel"
type ToolCall = AssistantMessageResponse["toolCalls"][number]

type TranscriptEntry = {
  id: string
  role: "user" | "assistant"
  text: string
  toolCalls?: AssistantMessageResponse["toolCalls"]
  clarification?: string | null
  error?: string | null
}

const MAX_HISTORY_ENTRIES = 8

function formatTaskTitles(titles: string[]) {
  if (titles.length === 0) {
    return ""
  }

  if (titles.length === 1) {
    return titles[0]
  }

  if (titles.length === 2) {
    return `${titles[0]} and ${titles[1]}`
  }

  return `${titles.slice(0, -1).join(", ")}, and ${titles[titles.length - 1]}`
}

function buildIntroFromTaskContext(tasks: Task[]) {
  if (tasks.length > 0) {
    const upcomingTitles = tasks
      .filter((task) => task.status !== "completed" && task.status !== "missed")
      .slice(0, 3)
      .map((task) => task.title)

    if (upcomingTitles.length > 0) {
      return `${tasks.length} open tasks. Top of queue: ${formatTaskTitles(upcomingTitles)}.`
    }

    return `${tasks.length} tasks on file.`
  }

  return "Ready."
}

function ToolCallReceipt({
  toolCalls,
  busyToolRunIds,
  onApprovalAction,
}: {
  toolCalls: AssistantMessageResponse["toolCalls"]
  busyToolRunIds: Set<string>
  onApprovalAction: (toolCall: ToolCall, action: ApprovalAction) => void
}) {
  if (toolCalls.length === 0) {
    return null
  }

  return (
    <div className="mt-2 space-y-1">
      {toolCalls.map((toolCall) => {
        const tone =
          toolCall.status === "completed"
            ? "text-foreground/80"
            : toolCall.status === "clarification" || toolCall.status === "pending_approval"
              ? "copper"
              : "text-destructive"

        return (
          <div key={toolCall.id} className="flex items-center gap-2 text-[12px]">
            <span className="num text-[10.5px] font-medium uppercase text-muted-foreground">
              {toolCall.tool}
            </span>
            <span className={`num text-[10.5px] font-medium uppercase ${tone}`}>
              {toolCall.status}
            </span>
            <span className="flex-1 truncate text-[12px] text-muted-foreground">
              {toolCall.summary}
            </span>
            {toolCall.status === "pending_approval" && toolCall.requiresApproval ? (
              <span className="flex shrink-0 items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Approve external write"
                      disabled={busyToolRunIds.has(toolCall.id)}
                      onClick={() => onApprovalAction(toolCall, "approve")}
                      className="flex h-6 w-6 items-center justify-center rounded-sm text-copper transition-colors hover:bg-copper-soft disabled:opacity-40"
                    >
                      {busyToolRunIds.has(toolCall.id) ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
                      ) : (
                        <Check className="h-3.5 w-3.5" strokeWidth={1.9} />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-[11px]">Approve</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Cancel external write"
                      disabled={busyToolRunIds.has(toolCall.id)}
                      onClick={() => onApprovalAction(toolCall, "cancel")}
                      className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={1.9} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-[11px]">Cancel</TooltipContent>
                </Tooltip>
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="text-[13px] leading-[1.52] text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-4 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-4 last:mb-0">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          strong: ({ children }) => <strong className="font-medium text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic text-foreground">{children}</em>,
          code: ({ children }) => (
            <code className="num rounded-sm bg-accent px-1 py-0.5 text-[11px] text-foreground">
              {children}
            </code>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

function ThinkingBubble() {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <span className="num text-[10px] font-medium uppercase copper">JARVIS</span>
      <span className="flex h-5 items-center gap-1">
        <span className="h-1 w-1 animate-pulse rounded-full bg-copper [animation-delay:-0.3s]" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-copper [animation-delay:-0.15s]" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-copper" />
      </span>
    </div>
  )
}

interface MasterInputProps {
  tasks?: Task[]
}

export function MasterInput({ tasks = [] }: MasterInputProps) {
  const [message, setMessage] = useState("")
  const [status, setStatus] = useState<SubmitStatus>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [context, setContext] = useState<AssistantContextResponse["context"] | null>(null)
  const [busyToolRunIds, setBusyToolRunIds] = useState<Set<string>>(() => new Set())
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([
    {
      id: "assistant-intro",
      role: "assistant",
      text: buildIntroFromTaskContext(tasks),
    },
  ])
  const [openContext, setOpenContext] = useState<"none" | "availability" | "memory">("none")
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const transcriptBottomRef = useRef<HTMLDivElement | null>(null)

  const derivedTaskContext = useMemo(() => buildIntroFromTaskContext(tasks), [tasks])

  const scrollTranscriptToBottom = (behavior: ScrollBehavior = "smooth") => {
    if (transcriptBottomRef.current) {
      transcriptBottomRef.current.scrollIntoView({ block: "end", behavior })
      return
    }

    if (transcriptRef.current) {
      transcriptRef.current.scrollTo({
        top: transcriptRef.current.scrollHeight,
        behavior,
      })
    }
  }

  useEffect(() => {
    let isActive = true

    const loadContext = async () => {
      try {
        const response = await fetch("/api/assistant/context", { cache: "no-store" })
        const payload = (await response.json().catch(() => null)) as AssistantContextResponse | null

        if (!isActive || !payload || !payload.ok) {
          throw new Error(payload?.error || "Failed to load secretary context.")
        }

        setContext(payload.context)
      } catch (error) {
        if (!isActive) {
          return
        }

        setErrorMessage(error instanceof Error ? error.message : "Failed to load secretary context.")
      }
    }

    void loadContext()

    return () => {
      isActive = false
    }
  }, [])

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(() => {
      scrollTranscriptToBottom(status === "submitting" ? "auto" : "smooth")
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [transcript, status])

  useEffect(() => {
    setTranscript((current) => {
      if (current.length !== 1 || current[0]?.id !== "assistant-intro") {
        return current
      }

      if (current[0].text === derivedTaskContext) {
        return current
      }

      return [
        {
          ...current[0],
          text: derivedTaskContext,
        },
      ]
    })
  }, [derivedTaskContext])

  const availabilityLines = useMemo(() => {
    if (!context) {
      return []
    }

    return [
      `Timezone ${context.availability.timezone}`,
      `Workday ${context.availability.workdayStart}–${context.availability.workdayEnd}`,
      context.availability.peakEnergyWindow ? `Peak ${context.availability.peakEnergyWindow}` : null,
      context.availability.sleepPattern ? `Sleep ${context.availability.sleepPattern}` : null,
      context.availability.procrastinationPattern
        ? `Friction ${context.availability.procrastinationPattern}`
        : null,
    ].filter((line): line is string => Boolean(line))
  }, [context])

  const requestHistory = useMemo<AssistantMessageRequest["history"]>(() => {
    return transcript
      .filter((entry) => entry.text.trim().length > 0 && !entry.error)
      .slice(-MAX_HISTORY_ENTRIES)
      .map((entry) => ({
        role: entry.role,
        text: entry.text,
      }))
  }, [transcript])

  async function submitMessage(rawMessage: string) {
    const trimmedMessage = rawMessage.trim()

    if (!trimmedMessage) {
      return
    }

    const userEntry: TranscriptEntry = {
      id: crypto.randomUUID(),
      role: "user",
      text: trimmedMessage,
    }

    setTranscript((current) => [...current, userEntry])
    setStatus("submitting")
    setErrorMessage(null)
    setMessage("")

    window.requestAnimationFrame(() => {
      scrollTranscriptToBottom("auto")
    })

    try {
      const requestBody: AssistantMessageRequest = {
        message: trimmedMessage,
        now: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        history: requestHistory,
      }

      const response = await fetch("/api/assistant/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      })

      const result = (await response.json().catch(() => null)) as AssistantMessageResponse | null

      if (!result) {
        throw new Error("The secretary returned an invalid response.")
      }

      if (result.context) {
        setContext(result.context)
      }
      setTranscript((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: result.reply,
          toolCalls: result.toolCalls,
          clarification: result.clarification,
          error: result.ok ? null : result.error ?? null,
        },
      ])

      if (!response.ok || !result.ok) {
        setStatus("error")
        setErrorMessage(result.error || result.reply)
        return
      }

      if (result.needsRefresh) {
        window.dispatchEvent(new CustomEvent("jarvis-dashboard-refresh"))
      }

      setStatus("idle")
    } catch (error) {
      const nextError = error instanceof Error ? error.message : "Something went wrong."
      setStatus("error")
      setErrorMessage(nextError)
      setTranscript((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "Hit an error before that finished.",
          error: nextError,
        },
      ])
    }
  }

  const handleSubmit = async () => {
    await submitMessage(message)
  }

  async function handleApprovalAction(toolCall: ToolCall, action: ApprovalAction) {
    setBusyToolRunIds((current) => new Set(current).add(toolCall.id))
    setErrorMessage(null)

    try {
      const response = await fetch(`/api/assistant/tool-runs/${toolCall.id}/${action}`, {
        method: "POST",
      })
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        toolCall?: ToolCall
      } | null

      if (!payload?.toolCall) {
        throw new Error(payload?.error || "The approval request returned an invalid response.")
      }

      setTranscript((current) =>
        current.map((entry) => ({
          ...entry,
          toolCalls: entry.toolCalls?.map((item) => (item.id === toolCall.id ? payload.toolCall as ToolCall : item)),
        })),
      )

      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || payload.toolCall.errorMessage || "Approval action failed.")
      }

      window.dispatchEvent(new CustomEvent("jarvis-dashboard-refresh"))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Approval action failed.")
    } finally {
      setBusyToolRunIds((current) => {
        const next = new Set(current)
        next.delete(toolCall.id)
        return next
      })
    }
  }

  const handleKeyDown = async (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      await submitMessage(message)
    }
  }

  const toggleContext = (key: "availability" | "memory") => {
    setOpenContext((current) => (current === key ? "none" : key))
  }

  return (
    <section className="flex flex-col">
      <div className="border border-rule/80 bg-panel/45 px-4 py-4">
        <header className="mb-4 flex items-center justify-between gap-2">
          <h2 className="eyebrow">Secretary</h2>
          <span className="num flex items-center gap-1.5 text-[10.5px] font-medium uppercase text-muted-foreground">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                status === "error" ? "bg-destructive" : "bg-copper"
              }`}
              aria-hidden="true"
            />
            {status === "submitting" ? "Thinking" : status === "error" ? "Error" : "Ready"}
          </span>
        </header>

        <div
          ref={transcriptRef}
          className="rail-scroll max-h-[min(62vh,600px)] min-h-[2.5rem] overflow-y-auto overscroll-contain pr-1.5"
        >
          <div className="space-y-4">
            {transcript.map((entry) => {
              const isUser = entry.role === "user"
              return (
                <article
                  key={entry.id}
                  className={`flex animate-in flex-col gap-1.5 fade-in-0 slide-in-from-bottom-1 duration-300 ease-out ${
                    isUser ? "items-end" : "items-start"
                  }`}
                >
                  {isUser ? (
                    <p className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[13px] leading-[1.5] text-foreground">
                      {entry.text}
                    </p>
                  ) : (
                    <>
                      <span className="num text-[10px] font-medium uppercase copper">JARVIS</span>
                      <div className="max-w-[90%] min-w-0">
                        <MarkdownMessage text={entry.text} />
                        {entry.error && (
                          <p className="mt-1.5 text-[12px] text-destructive">{entry.error}</p>
                        )}
                        {entry.clarification && (
                          <p className="mt-1.5 text-[12px] copper">{entry.clarification}</p>
                        )}
                        {entry.toolCalls && (
                          <ToolCallReceipt
                            toolCalls={entry.toolCalls}
                            busyToolRunIds={busyToolRunIds}
                            onApprovalAction={handleApprovalAction}
                          />
                        )}
                      </div>
                    </>
                  )}
                </article>
              )
            })}
            {status === "submitting" ? (
              <div className="animate-in fade-in-0 duration-200">
                <ThinkingBubble />
              </div>
            ) : null}
          </div>
          <div ref={transcriptBottomRef} />
        </div>

        {errorMessage && (
          <p className="mt-2 text-[12px] text-destructive">{errorMessage}</p>
        )}

        <div className="group/composer mt-5 flex min-h-11 items-end gap-2 rounded-lg border border-rule bg-background/50 px-3.5 py-2.5 transition-colors focus-within:border-copper/55 focus-within:bg-background/70">
          <Textarea
            placeholder="Message JARVIS…"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Secretary input"
            className="max-h-[140px] min-h-[28px] resize-none rounded-none border-0 bg-transparent p-0 pt-0.5 text-[13.5px] leading-[1.48] text-foreground shadow-none outline-none placeholder:text-muted-foreground/65 focus-visible:ring-0 dark:bg-transparent"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={status === "submitting" || !message.trim()}
                aria-label="Send (Enter)"
                className={`mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm transition-colors disabled:opacity-30 ${
                  message.trim() && status !== "submitting"
                    ? "text-copper hover:bg-copper-soft"
                    : "text-muted-foreground"
                }`}
              >
                <ArrowUp className="h-4 w-4" strokeWidth={1.85} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px]">Send · Enter</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="mt-3 border-t border-rule-strong/70 pt-3">
        <div className="flex h-8 items-center gap-5">
          {(["availability", "memory"] as const).map((key) => {
            const open = openContext === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleContext(key)}
                className={`group/chip flex h-7 items-center gap-1.5 border-b border-transparent text-[10.5px] font-medium uppercase transition-colors ${
                  open
                    ? "border-copper/70 text-foreground"
                    : "text-muted-foreground hover:border-rule-strong hover:text-foreground"
                }`}
              >
                <span className="num">{key}</span>
                <ChevronDown
                  className={`h-3 w-3 transition-transform ${open ? "rotate-180 copper" : ""}`}
                  aria-hidden="true"
                />
              </button>
            )
          })}
        </div>

        {openContext === "availability" ? (
          <div className="mt-2 space-y-2.5 bg-muted/20 px-3 py-3">
            {context ? (
              <>
                <p className="whitespace-pre-line text-[13px] leading-[1.55] text-muted-foreground">
                  {context.availability.availabilitySummary}
                </p>
                <ul className="space-y-1">
                  {availabilityLines.map((line) => (
                    <li key={line} className="num text-[12.5px] text-foreground">
                      {line}
                    </li>
                  ))}
                </ul>
                {context.availabilityWindows.length > 0 ? (
                  <div className="space-y-0.5 pt-1">
                    <p className="eyebrow">Windows</p>
                    {context.availabilityWindows.slice(0, 8).map((window) => (
                      <p key={`${window.localDay}-${window.start}`} className="num text-[12.5px] text-foreground">
                        {window.localDay}{" "}
                        {new Date(window.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        –{new Date(window.end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </p>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-[12px] text-muted-foreground">Loading…</p>
            )}
          </div>
        ) : null}

        {openContext === "memory" ? (
          <div className="mt-2 space-y-2.5 bg-muted/20 px-3 py-3">
            {context ? (
              <ul className="space-y-2.5">
                {context.memoryEntries.map((entry) => (
                  <li key={entry.id}>
                    <p className="text-[13px] leading-snug text-foreground">{entry.insight}</p>
                    <p className="num mt-0.5 text-[10.5px] uppercase text-muted-foreground">
                      {entry.category} · {new Date(entry.createdAt).toLocaleDateString()}
                    </p>
                  </li>
                ))}
                {context.memoryEntries.length === 0 ? (
                  <li className="text-[12px] text-muted-foreground">No memory yet.</li>
                ) : null}
              </ul>
            ) : (
              <p className="text-[12px] text-muted-foreground">Loading…</p>
            )}
          </div>
        ) : null}
      </div>
    </section>
  )
}
