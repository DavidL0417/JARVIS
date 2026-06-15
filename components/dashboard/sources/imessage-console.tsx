"use client"

import { useCallback, useEffect, useState } from "react"
import { ChevronDown, Loader2, Plus, Trash2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { FieldDescription, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import {
  DetailHeader,
  InfoLine,
  InlineError,
  type ConnectorDefinition,
  type ConnectorState,
} from "@/components/dashboard/sources/shared"

interface ImessageContact {
  id: string
  displayName: string
  handle: string
  handleNorm: string
}

interface ImessageSuggestionMessage {
  text: string
  isFromMe: boolean
  sentAt: string | null
}

interface ImessageSuggestion {
  handle: string
  handleNorm: string
  displayName: string | null
  lastSeen: string | null
  messageCount: number
  sentCount: number
  recvCount: number
  recentMessages?: ImessageSuggestionMessage[]
}

function relativeTime(iso: string | null): string {
  if (!iso) {
    return ""
  }
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) {
    return ""
  }
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

// Operator-only allowlist editor + suggested-contacts list. Self-contained: fetches
// and mutates via the 404-gated /api/integrations/imessage/{allowlist,suggestions}
// routes, so the host panel needs no iMessage-specific state. Only rendered for the operator.
export function ImessageConsolePane({
  connector,
  state,
}: {
  connector: ConnectorDefinition
  state: ConnectorState
}) {
  const [contacts, setContacts] = useState<ImessageContact[]>([])
  const [suggestions, setSuggestions] = useState<ImessageSuggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [nameInput, setNameInput] = useState("")
  const [handleInput, setHandleInput] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  function toggleExpanded(handleNorm: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(handleNorm)) {
        next.delete(handleNorm)
      } else {
        next.add(handleNorm)
      }
      return next
    })
  }

  const refreshSuggestions = useCallback(async () => {
    try {
      const response = await fetch("/api/integrations/imessage/suggestions")
      if (!response.ok) {
        return
      }
      const data = await response.json().catch(() => null)
      setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : [])
    } catch {
      // non-fatal — suggestions are a convenience
    }
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [allowRes, sugRes] = await Promise.all([
        fetch("/api/integrations/imessage/allowlist"),
        fetch("/api/integrations/imessage/suggestions"),
      ])
      if (!allowRes.ok) {
        throw new Error(
          allowRes.status === 404
            ? "iMessage console is not enabled for this account."
            : "Failed to load the allowlist.",
        )
      }
      const allowData = await allowRes.json()
      setContacts(Array.isArray(allowData?.contacts) ? allowData.contacts : [])
      if (sugRes.ok) {
        const sugData = await sugRes.json().catch(() => null)
        setSuggestions(Array.isArray(sugData?.suggestions) ? sugData.suggestions : [])
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load the allowlist.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  async function addContact(displayName: string, handle: string): Promise<boolean> {
    const name = displayName.trim()
    const value = handle.trim()
    if (!name || !value) {
      return false
    }

    setBusy(true)
    setError("")
    try {
      const response = await fetch("/api/integrations/imessage/allowlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name, handle: value }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to add the contact.")
      }
      setContacts(Array.isArray(data?.contacts) ? data.contacts : [])
      // The added contact drops off the suggestion list (server excludes allowlisted).
      setSuggestions((current) => current.filter((item) => item.handle !== value))
      void refreshSuggestions()
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to add the contact.")
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handleAddFromForm() {
    if (await addContact(nameInput, handleInput)) {
      setNameInput("")
      setHandleInput("")
    }
  }

  async function handleRemove(id: string) {
    setBusy(true)
    setError("")
    try {
      const response = await fetch(`/api/integrations/imessage/allowlist?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.error ?? "Failed to remove the contact.")
      }
      setContacts(Array.isArray(data?.contacts) ? data.contacts : [])
      // A removed contact may re-appear as a recent suggestion.
      void refreshSuggestions()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to remove the contact.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <DetailHeader connector={connector} state={state} />
      <p className="max-w-[60ch] text-[12px] leading-5 text-muted-foreground">
        A reader on your Mac forwards only these people&apos;s conversations into JARVIS — full message text is
        archived so the assistant can read your threads. Everyone else (spam, 2FA codes, shortcodes, and group chats
        with no one on this list) is dropped on your machine before anything is sent.
      </p>

      <div className="flex flex-col gap-2">
        <FieldLabel className="text-[12px]">Add a contact</FieldLabel>
        <div className="flex flex-col gap-2 sm:flex-row">
          <InputGroup className="min-w-0 flex-1 rounded-sm border-rule bg-secondary/20">
            <InputGroupInput
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder="Name (e.g. Alan Tai)"
              disabled={busy}
              className="min-w-0 text-[12px]"
            />
          </InputGroup>
          <InputGroup className="min-w-0 flex-1 rounded-sm border-rule bg-secondary/20">
            <InputGroupInput
              value={handleInput}
              onChange={(event) => setHandleInput(event.target.value)}
              placeholder="Phone or email"
              disabled={busy}
              className="min-w-0 text-[12px]"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton onClick={handleAddFromForm} disabled={busy || !nameInput.trim() || !handleInput.trim()}>
                <Plus aria-hidden="true" />
                Add
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>
        <FieldDescription className="text-[11px]">
          Phones match on the last 10 digits; emails are case-insensitive.
        </FieldDescription>
      </div>

      {suggestions.length > 0 ? (
        <div className="flex flex-col">
          <div className="flex items-center justify-between border-b border-rule pb-2">
            <FieldLabel className="text-[12px]">Suggested · recent contacts</FieldLabel>
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{suggestions.length}</span>
          </div>
          <ul className="flex min-w-0 flex-col">
            {suggestions.map((suggestion) => {
              const label = suggestion.displayName || suggestion.handle
              const meta = [
                suggestion.displayName ? suggestion.handle : null,
                relativeTime(suggestion.lastSeen),
                suggestion.messageCount ? `${suggestion.messageCount} msgs` : null,
              ]
                .filter(Boolean)
                .join(" · ")
              const isOpen = expanded.has(suggestion.handleNorm)
              const preview = suggestion.recentMessages ?? []
              return (
                <li key={suggestion.handleNorm} className="flex flex-col border-b border-rule/60 last:border-b-0">
                  <div className="flex items-center justify-between gap-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(suggestion.handleNorm)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? "Hide" : "Show"} recent texts with ${label}`}
                    >
                      <ChevronDown
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform",
                          isOpen ? "rotate-0" : "-rotate-90",
                        )}
                        aria-hidden="true"
                        strokeWidth={1.75}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-foreground">{label}</span>
                        {meta ? <span className="block truncate text-[11px] text-muted-foreground">{meta}</span> : null}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void addContact(suggestion.displayName || suggestion.handle, suggestion.handle)}
                      disabled={busy}
                      className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-rule px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-copper/50 hover:text-copper disabled:opacity-50"
                      aria-label={`Add ${label}`}
                    >
                      <Plus className="h-3 w-3" aria-hidden="true" strokeWidth={2} />
                      Add
                    </button>
                  </div>
                  {isOpen ? (
                    <div className="flex flex-col gap-1 pb-2.5 pl-[22px]">
                      {preview.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">No recent text preview available.</p>
                      ) : (
                        preview.map((message, index) => (
                          <p key={index} className="text-[11px] leading-4 [overflow-wrap:anywhere]">
                            <span
                              className={cn(
                                "font-medium",
                                message.isFromMe ? "text-copper/80" : "text-muted-foreground",
                              )}
                            >
                              {message.isFromMe ? "You" : label}:
                            </span>{" "}
                            <span className="text-foreground/80">{message.text}</span>
                          </p>
                        ))
                      )}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
          <FieldDescription className="mt-2 text-[11px]">
            Recent two-way conversations you haven&apos;t added yet. Refreshes when the reader runs.
          </FieldDescription>
        </div>
      ) : null}

      <div className="flex flex-col">
        <div className="flex items-center justify-between border-b border-rule pb-2">
          <FieldLabel className="text-[12px]">Allowlisted contacts</FieldLabel>
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{contacts.length}</span>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-[12px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-copper" aria-hidden="true" /> Loading…
          </div>
        ) : contacts.length === 0 ? (
          <p className="py-4 text-[12px] text-muted-foreground">
            No contacts yet. Add someone above to start forwarding their conversations.
          </p>
        ) : (
          <ul className="flex min-w-0 flex-col">
            {contacts.map((contact) => (
              <li
                key={contact.id}
                className="flex items-center justify-between gap-3 border-b border-rule/60 py-2 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-foreground">{contact.displayName}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{contact.handle}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRemove(contact.id)}
                  disabled={busy}
                  className="shrink-0 rounded-sm p-1.5 text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  aria-label={`Remove ${contact.displayName}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={1.75} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col">
        <InfoLine label="Direction" value="Mac to JARVIS (one-way, read-only)" />
        <InfoLine label="Sync" value="3×/day via local launchd reader" />
      </div>

      <InlineError message={error} />
    </div>
  )
}
