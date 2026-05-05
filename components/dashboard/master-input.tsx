"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
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
      return `I see ${tasks.length} tasks, including ${formatTaskTitles(upcomingTitles)}.`
    }

    return `I see ${tasks.length} tasks.`
  }

  return "Ready."
}

function ToolCallReceipt({ toolCalls }: { toolCalls: AssistantMessageResponse["toolCalls"] }) {
  if (toolCalls.length === 0) {
    return null
  }

  return (
    <div className="mt-3 grid grid-cols-1 gap-2">
      {toolCalls.map((toolCall) => (
        <div
          key={toolCall.id}
          className={`rounded-lg border px-3 py-2 ${
            toolCall.status === "completed"
              ? "border-success/35 bg-success/10"
              : toolCall.status === "clarification" || toolCall.status === "pending_approval"
                ? "border-warning/35 bg-warning/10"
                : "border-destructive/35 bg-destructive/10"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground">{toolCall.tool}</p>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{toolCall.status}</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{toolCall.summary}</p>
        </div>
      ))}
    </div>
  )
}

function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="text-xs leading-relaxed text-inherit">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-4 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-4 last:mb-0">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-inherit">{children}</strong>,
          em: ({ children }) => <em className="italic text-inherit">{children}</em>,
          code: ({ children }) => (
            <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[11px] text-inherit">
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
    <div className="flex justify-start">
      <div className="max-w-[92%] rounded-md border border-border bg-surface-subtle px-3 py-2 text-foreground">
        <div className="flex items-center gap-2 text-xs leading-relaxed">
          <span className="font-medium">JARVIS is thinking</span>
          <span className="flex gap-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
          </span>
        </div>
      </div>
    </div>
  )
}

interface MasterInputProps {
  tasks?: Task[]
}

export function MasterInput({
  tasks = [],
}: MasterInputProps) {
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
      `Timezone: ${context.availability.timezone}`,
      `Workday: ${context.availability.workdayStart} - ${context.availability.workdayEnd}`,
      context.availability.peakEnergyWindow
        ? `Peak energy: ${context.availability.peakEnergyWindow}`
        : null,
      context.availability.sleepPattern
        ? `Sleep / no-work note: ${context.availability.sleepPattern}`
        : null,
      context.availability.procrastinationPattern
        ? `Planning friction: ${context.availability.procrastinationPattern}`
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
      const nextError = error instanceof Error ? error.message : "Something went wrong while talking to the secretary."
      setStatus("error")
      setErrorMessage(nextError)
      setTranscript((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "I hit an error before I could finish that request.",
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

  return (
    <Card className="flex flex-col overflow-hidden border-border bg-card">
      <CardHeader className="p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-semibold text-foreground">Command</CardTitle>
          </div>
          <div className="rounded-md border border-border bg-background px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
            {status === "submitting" ? "Thinking" : "Ready"}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-4 pt-0">
        <div
          ref={transcriptRef}
          className="h-[240px] overflow-y-auto rounded-md border border-border bg-background/50"
        >
          <div className="space-y-3 p-4">
            {transcript.map((entry) => (
              <div key={entry.id} className={`flex ${entry.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[92%] rounded-md px-3 py-2 ${
                    entry.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-card text-foreground"
                  }`}
                >
                  {entry.role === "assistant" ? (
                    <MarkdownMessage text={entry.text} />
                  ) : (
                    <p className="whitespace-pre-wrap text-xs leading-relaxed">{entry.text}</p>
                  )}
                  {entry.error && (
                    <p className="mt-2 text-[11px] font-medium text-destructive">{entry.error}</p>
                  )}
                  {entry.clarification && (
                    <p className="mt-2 text-[11px] font-medium text-warning">{entry.clarification}</p>
                  )}
                  {entry.toolCalls && <ToolCallReceipt toolCalls={entry.toolCalls} />}
                </div>
              </div>
            ))}
            {status === "submitting" && <ThinkingBubble />}
            <div ref={transcriptBottomRef} />
          </div>
        </div>

        {errorMessage && (
          <div className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2">
            <p className="text-xs font-medium text-destructive">{errorMessage}</p>
          </div>
        )}

        <Accordion type="multiple" className="rounded-md border border-border bg-background/40 px-3">
          <AccordionItem value="availability">
            <AccordionTrigger className="py-3 text-xs font-semibold text-foreground hover:no-underline">
              Availability
            </AccordionTrigger>
            <AccordionContent className="space-y-2">
              {context ? (
                <>
                  <p className="text-xs text-muted-foreground whitespace-pre-line">
                    {context.availability.availabilitySummary}
                  </p>
                  <div className="space-y-1">
                    {availabilityLines.map((line) => (
                      <p key={line} className="rounded-md border border-border bg-card px-3 py-2 text-[11px] text-foreground">
                        {line}
                      </p>
                    ))}
                  </div>
                  <div className="space-y-1 pt-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Derived windows
                    </p>
                    {context.availabilityWindows.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">No preferred windows are currently derived.</p>
                    ) : (
                      context.availabilityWindows.slice(0, 8).map((window) => (
                        <p key={`${window.localDay}-${window.start}`} className="text-[11px] text-foreground">
                          {window.localDay}:{" "}
                          {new Date(window.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} -{" "}
                          {new Date(window.end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        </p>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Loading availability context...</p>
              )}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="memory">
            <AccordionTrigger className="py-3 text-xs font-semibold text-foreground hover:no-underline">
              Memory
            </AccordionTrigger>
            <AccordionContent className="space-y-2">
              <p className="text-xs text-muted-foreground whitespace-pre-line">
                {context?.memorySummary || "Loading memory context..."}
              </p>
              <div className="space-y-2">
                {(context?.memoryEntries || []).map((entry) => (
                  <div key={entry.id} className="rounded-md border border-border bg-card px-3 py-2">
                    <p className="text-xs text-foreground">{entry.insight}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {entry.category} - {new Date(entry.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                ))}
                {context && context.memoryEntries.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">No saved memory notes yet.</p>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="rounded-md border border-border bg-background/50 p-3">
          <Textarea
            placeholder="Tell your secretary what changed..."
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Secretary input request"
            className="min-h-[72px] resize-none border-0 bg-transparent px-1 text-xs text-foreground shadow-none focus-visible:ring-0"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">Enter to send.</p>
            <Button
              onClick={handleSubmit}
              disabled={status === "submitting"}
              aria-label="Send secretary request"
              className="h-8 shrink-0 px-4 text-xs font-semibold"
            >
              {status === "submitting" ? "Thinking..." : "Send"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
