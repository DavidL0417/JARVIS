"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import { ArrowUp, ChevronDown, Loader2 } from "lucide-react"

import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type {
  AssistantContextResponse,
  AssistantMessageRequest,
  AssistantMessageResponse,
  Task,
} from "@/types"

type SubmitStatus = "idle" | "submitting" | "error"

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

function ToolCallReceipt({ toolCalls }: { toolCalls: AssistantMessageResponse["toolCalls"] }) {
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
          <div key={toolCall.id} className="flex items-baseline gap-2 text-[12px]">
            <span className="num text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {toolCall.tool}
            </span>
            <span className={`num text-[10.5px] font-medium uppercase tracking-[0.14em] ${tone}`}>
              {toolCall.status}
            </span>
            <span className="flex-1 truncate text-[12px] text-muted-foreground">
              {toolCall.summary}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="text-[13.5px] leading-[1.55] text-foreground">
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
    <div className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-3">
      <span className="num pt-0.5 text-[10.5px] font-medium uppercase tracking-[0.16em] copper">JARVIS</span>
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

      setContext(result.context)
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
      <header className="mb-4 flex items-center justify-between gap-2">
        <h2 className="eyebrow">Secretary</h2>
        <span className="num flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status === "submitting"
                ? "animate-pulse bg-copper"
                : status === "error"
                  ? "bg-destructive"
                  : "bg-copper"
            }`}
            aria-hidden="true"
          />
          {status === "submitting" ? "Thinking" : status === "error" ? "Error" : "Ready"}
        </span>
      </header>

      <div
        ref={transcriptRef}
        className="max-h-[260px] min-h-[3rem] overflow-y-auto pr-1"
      >
        <div className="space-y-5">
          {transcript.map((entry) => (
            <article
              key={entry.id}
              className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-3"
            >
              <span
                className={`num pt-0.5 text-[10.5px] font-medium uppercase tracking-[0.16em] ${
                  entry.role === "user" ? "text-muted-foreground" : "copper"
                }`}
              >
                {entry.role === "user" ? "You" : "JARVIS"}
              </span>
              <div className="min-w-0">
                {entry.role === "assistant" ? (
                  <MarkdownMessage text={entry.text} />
                ) : (
                  <p className="whitespace-pre-wrap text-[13.5px] leading-[1.55] text-foreground">
                    {entry.text}
                  </p>
                )}
                {entry.error && (
                  <p className="mt-1 text-[12px] text-destructive">{entry.error}</p>
                )}
                {entry.clarification && (
                  <p className="mt-1 text-[12px] copper">{entry.clarification}</p>
                )}
                {entry.toolCalls && <ToolCallReceipt toolCalls={entry.toolCalls} />}
              </div>
            </article>
          ))}
          {status === "submitting" ? (
            <div>
              <ThinkingBubble />
            </div>
          ) : null}
        </div>
        <div ref={transcriptBottomRef} />
      </div>

      {errorMessage && (
        <p className="mt-2 text-[12px] text-destructive">{errorMessage}</p>
      )}

      <div className="mt-5 border-t border-rule pt-3">
        <div className="group/composer flex min-h-11 items-end gap-2">
          <Textarea
            placeholder="Message JARVIS…"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Secretary input"
            className="max-h-[118px] min-h-[32px] resize-none rounded-none border-0 bg-transparent p-0 pt-1 text-[14px] leading-[1.55] text-foreground shadow-none outline-none placeholder:text-muted-foreground/65 focus-visible:ring-0 dark:bg-transparent"
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
                {status === "submitting" ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                ) : (
                  <ArrowUp className="h-4 w-4" strokeWidth={1.85} />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[11px]">Send · Enter</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex h-8 items-center gap-5">
          {(["availability", "memory"] as const).map((key) => {
            const open = openContext === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleContext(key)}
                className={`group/chip flex h-7 items-center gap-1.5 border-b border-transparent text-[10.5px] font-medium uppercase tracking-[0.16em] transition-colors ${
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
              <>
                <p className="whitespace-pre-line text-[13px] leading-[1.55] text-muted-foreground">
                  {context.memorySummary || "No memory summary."}
                </p>
                <ul className="space-y-2">
                  {context.memoryEntries.map((entry) => (
                    <li key={entry.id}>
                      <p className="text-[13px] leading-snug text-foreground">{entry.insight}</p>
                      <p className="num mt-0.5 text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                        {entry.category} · {new Date(entry.createdAt).toLocaleDateString()}
                      </p>
                    </li>
                  ))}
                  {context.memoryEntries.length === 0 ? (
                    <li className="text-[12px] text-muted-foreground">No memory yet.</li>
                  ) : null}
                </ul>
              </>
            ) : (
              <p className="text-[12px] text-muted-foreground">Loading…</p>
            )}
          </div>
        ) : null}
      </div>
    </section>
  )
}
