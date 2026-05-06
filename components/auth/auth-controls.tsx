"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, LogIn, LogOut } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { tryCreateSupabaseBrowserClient } from "@/lib/supabase/client"

type AuthViewState =
  | { status: "loading" }
  | { status: "signed-out" }
  | {
      status: "signed-in"
      user: {
        email: string
        name: string
        avatarUrl: string | null
      }
    }

function getFallbackInitials(name: string, email: string) {
  const source = name.trim() || email.trim()

  if (!source) {
    return "J"
  }

  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")
}

export function AuthControls() {
  const router = useRouter()
  const supabase = useMemo(() => tryCreateSupabaseBrowserClient(), [])
  const [authState, setAuthState] = useState<AuthViewState>({ status: "loading" })
  const [isMutating, setIsMutating] = useState(false)

  useEffect(() => {
    if (!supabase) {
      setAuthState({ status: "signed-out" })
      return
    }

    let isMounted = true

    const syncUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!isMounted) {
        return
      }

      if (!user || !user.email) {
        setAuthState({ status: "signed-out" })
        return
      }

      setAuthState({
        status: "signed-in",
        user: {
          email: user.email,
          name:
            user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            user.email.split("@")[0] ||
            "JARVIS User",
          avatarUrl: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
        },
      })
    }

    void syncUser()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void syncUser()
      router.refresh()
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [router, supabase])

  const handleSignIn = async () => {
    if (!supabase) {
      return
    }

    setIsMutating(true)

    const next = `${window.location.pathname}${window.location.search}`
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        scopes: [
          "https://www.googleapis.com/auth/calendar.readonly",
          "https://www.googleapis.com/auth/calendar.events",
        ].join(" "),
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    })

    if (error) {
      console.error("Failed to start Google sign-in", error)
      setIsMutating(false)
    }
  }

  const handleSignOut = async () => {
    if (!supabase) {
      return
    }

    setIsMutating(true)

    try {
      const response = await fetch("/auth/signout", {
        method: "POST",
      })

      if (!response.ok) {
        throw new Error("Failed to sign out.")
      }

      window.location.assign("/")
    } catch (error) {
      console.error("Failed to sign out", error)
      setIsMutating(false)
    }
  }

  if (authState.status === "loading") {
    return (
      <div
        aria-label="Loading auth"
        className="flex h-8 w-8 items-center justify-center text-muted-foreground"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </div>
    )
  }

  if (authState.status === "signed-out") {
    if (!supabase) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled
              aria-label="Auth unavailable"
              className="flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground/60"
            >
              <LogIn className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-[11px]">
            Set Supabase env vars to enable auth
          </TooltipContent>
        </Tooltip>
      )
    }

    return (
      <Button
        size="sm"
        onClick={handleSignIn}
        disabled={isMutating}
        className="h-8 gap-2 bg-copper px-3 text-[12px] font-medium text-primary-foreground hover:opacity-90"
      >
        {isMutating ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <LogIn className="h-3.5 w-3.5" />
        )}
        Sign in
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={authState.user.email}
            className="flex items-center"
          >
            <Avatar className="h-8 w-8 rounded-sm ring-1 ring-rule">
              <AvatarImage src={authState.user.avatarUrl || undefined} alt={authState.user.name} />
              <AvatarFallback className="num rounded-sm bg-accent text-[11px] font-medium text-foreground">
                {getFallbackInitials(authState.user.name, authState.user.email)}
              </AvatarFallback>
            </Avatar>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-[11px]">
          {authState.user.email}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Sign out"
            onClick={handleSignOut}
            disabled={isMutating}
            className="flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {isMutating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="h-4 w-4" strokeWidth={1.75} />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-[11px]">Sign out</TooltipContent>
      </Tooltip>
    </div>
  )
}
