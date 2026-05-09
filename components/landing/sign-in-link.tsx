"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

import { startGoogleOAuthRedirect } from "@/lib/supabase/auth-actions"

export function SignInLink({ className = "" }: { className?: string }) {
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const resetPending = () => setPending(false)
    const resetWhenVisible = () => {
      if (document.visibilityState === "visible") resetPending()
    }

    window.addEventListener("pageshow", resetPending)
    window.addEventListener("focus", resetPending)
    document.addEventListener("visibilitychange", resetWhenVisible)

    return () => {
      window.removeEventListener("pageshow", resetPending)
      window.removeEventListener("focus", resetPending)
      document.removeEventListener("visibilitychange", resetWhenVisible)
    }
  }, [])

  return (
    <button
      type="button"
      data-bloom-shield
      onClick={async () => {
        if (pending) return
        setPending(true)
        try {
          await startGoogleOAuthRedirect("/dashboard")
        } catch (error) {
          console.error("Failed to start sign-in", error)
          setPending(false)
        }
      }}
      className={`inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground ${className}`}
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
      Sign in
    </button>
  )
}
