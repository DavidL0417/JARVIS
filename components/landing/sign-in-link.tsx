"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

import { startGoogleOAuthRedirect } from "@/lib/supabase/auth-actions"

const AUTH_REDIRECT_KEY = "jarvis-auth-redirect-started"

export function SignInLink({ className = "" }: { className?: string }) {
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const resetPending = () => setPending(false)

    const handlePageShow = (event: PageTransitionEvent) => {
      const authRedirectStarted = window.sessionStorage.getItem(AUTH_REDIRECT_KEY) === "true"
      if (authRedirectStarted && event.persisted) {
        window.sessionStorage.removeItem(AUTH_REDIRECT_KEY)
        window.location.reload()
        return
      }

      if (authRedirectStarted) {
        window.sessionStorage.removeItem(AUTH_REDIRECT_KEY)
      }
      resetPending()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") resetPending()
    }

    window.addEventListener("pageshow", handlePageShow)
    window.addEventListener("focus", resetPending)
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      window.removeEventListener("pageshow", handlePageShow)
      window.removeEventListener("focus", resetPending)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [])

  return (
    <button
      type="button"
      onClick={async () => {
        if (pending) return
        setPending(true)
        try {
          window.sessionStorage.setItem(AUTH_REDIRECT_KEY, "true")
          await startGoogleOAuthRedirect("/dashboard")
        } catch (error) {
          console.error("Failed to start sign-in", error)
          window.sessionStorage.removeItem(AUTH_REDIRECT_KEY)
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
