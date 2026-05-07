"use client"

import { useRef, useState, type FormEvent } from "react"
import { ArrowRight, Loader2 } from "lucide-react"

import { useMagneticPull } from "@/hooks/use-magnetic-pull"

type Variant = "compact" | "anchor"

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "success"; message: string }

interface WaitlistFormProps {
  variant?: Variant
  id?: string
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const successCopy: Record<"added" | "already-on-list", string> = {
  added: "You're on the list. We'll send invites in order.",
  "already-on-list": "You're already on the list. Your spot is held.",
}

export function WaitlistForm({ variant = "compact", id = "waitlist" }: WaitlistFormProps) {
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  useMagneticPull(buttonRef, { strength: 0.18, radius: 96 })

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmed = email.trim()

    if (!trimmed || !EMAIL_PATTERN.test(trimmed)) {
      setStatus({ kind: "error", message: "That email doesn't look right." })
      return
    }

    setStatus({ kind: "submitting" })

    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      })

      const payload = (await response.json().catch(() => null)) as
        | { ok: boolean; status: "added" | "already-on-list" | "invalid" | "server-error"; message?: string }
        | null

      if (response.ok && payload?.ok && (payload.status === "added" || payload.status === "already-on-list")) {
        setStatus({ kind: "success", message: successCopy[payload.status] })
        return
      }

      const message = payload?.message ?? "Couldn't save that. Try again in a moment."
      setStatus({ kind: "error", message })
    } catch (error) {
      console.error("Waitlist submit failed", error)
      setStatus({ kind: "error", message: "Couldn't save that. Try again in a moment." })
    }
  }

  if (status.kind === "success") {
    return (
      <div
        role="status"
        aria-live="polite"
        className={
          variant === "anchor"
            ? "flex max-w-[36rem] items-center gap-3 border-t border-b border-[var(--rule-strong)] py-5 text-[15px] text-foreground"
            : "flex max-w-[28rem] items-center gap-3 border-t border-b border-[var(--rule-strong)] py-3.5 text-[14px] text-foreground"
        }
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--copper)]" aria-hidden="true" />
        <span className="leading-snug">{status.message}</span>
      </div>
    )
  }

  const isSubmitting = status.kind === "submitting"
  const inputBase =
    variant === "anchor"
      ? "h-12 flex-1 bg-transparent px-3 text-[15px] outline-none placeholder:text-muted-foreground/80"
      : "h-11 flex-1 bg-transparent px-3 text-[14px] outline-none placeholder:text-muted-foreground/80"

  const buttonBase =
    variant === "anchor"
      ? "inline-flex h-12 shrink-0 items-center gap-2 whitespace-nowrap bg-[var(--copper)] px-5 text-[14px] font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      : "inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap bg-[var(--copper)] px-4 text-[13px] font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"

  return (
    <form onSubmit={handleSubmit} className="w-full" noValidate>
      <div
        className={
          variant === "anchor"
            ? "flex w-full max-w-[36rem] items-stretch border border-[var(--rule-strong)] bg-[var(--card)] focus-within:border-[var(--copper)] focus-within:ring-1 focus-within:ring-[var(--copper-soft)]"
            : "flex w-full max-w-[28rem] items-stretch border border-[var(--rule-strong)] bg-[var(--card)] focus-within:border-[var(--copper)] focus-within:ring-1 focus-within:ring-[var(--copper-soft)]"
        }
      >
        <label className="sr-only" htmlFor={`${id}-email`}>
          School email
        </label>
        <input
          id={`${id}-email`}
          type="email"
          inputMode="email"
          autoComplete="email"
          spellCheck={false}
          required
          placeholder="you@school.edu"
          disabled={isSubmitting}
          value={email}
          onChange={(event) => {
            setEmail(event.target.value)
            if (status.kind === "error") setStatus({ kind: "idle" })
          }}
          className={inputBase}
          aria-invalid={status.kind === "error"}
          aria-describedby={status.kind === "error" ? `${id}-error` : undefined}
        />
        <button ref={buttonRef} type="submit" disabled={isSubmitting} className={buttonBase} style={{ willChange: "transform" }}>
          {isSubmitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} />
          )}
          {isSubmitting ? "Joining" : "Join waitlist"}
        </button>
      </div>
      <p
        id={`${id}-error`}
        role={status.kind === "error" ? "alert" : undefined}
        className={`mt-2 min-h-[1.25rem] text-[12px] leading-tight ${
          status.kind === "error" ? "text-[var(--copper)]" : "text-transparent"
        }`}
      >
        {status.kind === "error" ? status.message : "placeholder"}
      </p>
    </form>
  )
}
