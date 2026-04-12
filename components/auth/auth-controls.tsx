"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, LogIn, LogOut } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
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
      <Button
        variant="outline"
        size="sm"
        disabled
        className="text-xs h-8 px-3 font-semibold"
      >
        <Loader2 className="w-3 h-3 mr-2 animate-spin" />
        Auth
      </Button>
    )
  }

  if (authState.status === "signed-out") {
    if (!supabase) {
      return (
        <Button
          variant="outline"
          size="sm"
          disabled
          className="text-xs h-8 px-3 font-semibold"
          title="Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable auth."
        >
          <LogIn className="w-3 h-3 mr-2" />
          Auth unavailable
        </Button>
      )
    }

    return (
      <Button
        variant="outline"
        size="sm"
        onClick={handleSignIn}
        disabled={isMutating}
        className="text-xs h-8 px-3 font-semibold"
      >
        {isMutating ? (
          <Loader2 className="w-3 h-3 mr-2 animate-spin" />
        ) : (
          <LogIn className="w-3 h-3 mr-2" />
        )}
        Sign in with Google
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded border border-border px-2 py-1.5">
      <Avatar className="w-7 h-7">
        <AvatarImage src={authState.user.avatarUrl || undefined} alt={authState.user.name} />
        <AvatarFallback className="text-[10px] font-semibold">
          {getFallbackInitials(authState.user.name, authState.user.email)}
        </AvatarFallback>
      </Avatar>
      <div className="hidden sm:flex flex-col min-w-0">
        <span className="text-[11px] font-semibold text-foreground truncate max-w-[180px]">
          {authState.user.name}
        </span>
        <span className="text-[10px] text-muted-foreground truncate max-w-[180px]">
          {authState.user.email}
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleSignOut}
        disabled={isMutating}
        className="text-xs h-7 px-2 font-semibold"
      >
        {isMutating ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <LogOut className="w-3 h-3" />
        )}
      </Button>
    </div>
  )
}
