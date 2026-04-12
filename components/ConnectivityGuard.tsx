"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"

const CONNECTIVITY_TIMEOUT_MS = 60_000

type LoadingRegistrationOptions = {
  isLongRunningProcess?: boolean
}

type LoadingEntry = {
  isLongRunningProcess: boolean
}

type LoadingContextValue = {
  startLoading: (options?: LoadingRegistrationOptions) => string
  stopLoading: (id: string) => void
  withLoading: <T>(
    task: () => Promise<T>,
    options?: LoadingRegistrationOptions,
  ) => Promise<T>
}

const LoadingContext = createContext<LoadingContextValue | null>(null)

function buildLoadingId(sequence: number) {
  return `loading-${sequence}`
}

export function ConnectivityGuard({ children }: { children: ReactNode }) {
  const [loadingEntries, setLoadingEntries] = useState<Record<string, LoadingEntry>>({})
  const [isTimeoutTriggered, setIsTimeoutTriggered] = useState(false)
  const loadingSequenceRef = useRef(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const startLoading = useCallback((options: LoadingRegistrationOptions = {}) => {
    loadingSequenceRef.current += 1
    const id = buildLoadingId(loadingSequenceRef.current)

    setLoadingEntries((current) => ({
      ...current,
      [id]: {
        isLongRunningProcess: Boolean(options.isLongRunningProcess),
      },
    }))

    return id
  }, [])

  const stopLoading = useCallback((id: string) => {
    setLoadingEntries((current) => {
      if (!(id in current)) {
        return current
      }

      const next = { ...current }
      delete next[id]
      return next
    })
  }, [])

  const withLoading = useCallback<LoadingContextValue["withLoading"]>(
    async (task, options = {}) => {
      const id = startLoading(options)

      try {
        return await task()
      } finally {
        stopLoading(id)
      }
    },
    [startLoading, stopLoading],
  )

  const hasTrackedLoading = useMemo(() => {
    return Object.values(loadingEntries).some((entry) => !entry.isLongRunningProcess)
  }, [loadingEntries])

  useEffect(() => {
    if (!hasTrackedLoading) {
      setIsTimeoutTriggered(false)

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }

      return
    }

    timeoutRef.current = setTimeout(() => {
      setIsTimeoutTriggered(true)
    }, CONNECTIVITY_TIMEOUT_MS)

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [hasTrackedLoading])

  const contextValue = useMemo<LoadingContextValue>(
    () => ({
      startLoading,
      stopLoading,
      withLoading,
    }),
    [startLoading, stopLoading, withLoading],
  )

  return (
    <LoadingContext.Provider value={contextValue}>
      {children}
      {isTimeoutTriggered ? (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/45 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card/95 p-6 shadow-2xl">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary/80">
                <Loader2 className="h-8 w-8 animate-spin text-foreground" />
              </div>
              <div className="space-y-2">
                <h2 className="text-lg font-bold text-foreground">Weak connection, trying to reconnect...</h2>
                <p className="text-sm text-muted-foreground">
                  This request is taking longer than usual. You can keep waiting or reload the page.
                </p>
              </div>
              <Button
                type="button"
                onClick={() => window.location.reload()}
                className="w-full font-semibold"
              >
                Reload Page
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </LoadingContext.Provider>
  )
}

export function useLoading() {
  const context = useContext(LoadingContext)

  if (!context) {
    throw new Error("useLoading must be used within ConnectivityGuard.")
  }

  return context
}
