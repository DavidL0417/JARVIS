"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"

import { startGoogleOAuthRedirect } from "@/lib/supabase/auth-actions"

export function SignInLink({ className = "" }: { className?: string }) {
  const [pending, setPending] = useState(false)

  return (
    <button
      type="button"
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
